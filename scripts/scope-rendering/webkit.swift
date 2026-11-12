// Local WKWebView verification of the shared plugin renderers. No DAW or audio device is modified.
import AppKit
import WebKit
import Foundation

final class Runner: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    let manifest: [String: Any]
    let output: URL
    var results = [[String: Any]]()
    var index = 0
    var view: WKWebView!
    var window: NSWindow!
    var initialPids = Set<Int>()
    var before = [[String: Any]]()
    var started = Date()
    var runs: [[String: Any]] { manifest["runs"] as! [[String: Any]] }
    var config: [String: Any] { runs[index]["config"] as! [String: Any] }
    var benchmark: Bool { config["mode"] as? String == "benchmark" }
    init(manifest: [String: Any]) {
        self.manifest = manifest
        output = URL(fileURLWithPath: manifest["output"] as! String)
        super.init()
    }
    func start() {
        initialPids = Set(processes().compactMap { $0["pid"] as? Int })
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "done")
        configuration.userContentController.add(self, name: "failed")
        configuration.userContentController.add(self, name: "warmed")
        view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1400, height: 800), configuration: configuration)
        view.navigationDelegate = self
        window = NSWindow(contentRect: view.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "Prism scope WebKit verification"
        window.contentView = view
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        next()
    }
    func next() {
        if index == runs.count { NSApp.terminate(nil); return }
        let run = runs[index]
        let config = String(data: try! JSONSerialization.data(withJSONObject: run["config"]!), encoding: .utf8)!
        let bundle = run["bundle"] as! String
        let html = """
        <!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#171a20}canvas{vertical-align:top}\(manifest["fonts"] as! String)</style></head><body>
        <script>window.scopeRunConfig=\(config);window.onerror=(message)=>window.webkit.messageHandlers.failed.postMessage(String(message));</script>
        <script src="\(bundle)"></script></body></html>
        """
        let page = output.appendingPathComponent("webkit-fixture.html")
        try! html.write(to: page, atomically: true, encoding: .utf8)
        view.loadFileURL(page, allowingReadAccessTo: URL(fileURLWithPath: "/"))
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if benchmark {
            animate(seconds: manifest["warmup"] as? Double ?? 2, message: "warmed")
            return
        }
        webView.evaluateJavaScript("window.scopeReady.then(result=>window.webkit.messageHandlers.done.postMessage(JSON.stringify(result))).catch(error=>window.webkit.messageHandlers.failed.postMessage(String(error)));void 0") { _, error in
            if let error = error { self.fail(String(describing: error)) }
        }
    }
    func animate(seconds: Double, message: String) {
        let fps = config["fps"] as! Int
        view.evaluateJavaScript("""
        (async()=>{
          await window.scopeReady;
          const start=performance.now(), intervals=[], costs=[];let count=0,previous=start;
          while(performance.now()-start<\(seconds * 1000)) {
            const now=performance.now();intervals.push(now-previous);previous=now;
            window.scopeFixture.tick();costs.push(performance.now()-now);count++;
            await new Promise(r=>setTimeout(r,Math.max(0,start+count*1000/\(fps)-performance.now())));
          }
          const result={count,elapsed:performance.now()-start,p95FrameMs:intervals.sort((a,b)=>a-b)[Math.floor(intervals.length*.95)],
            p95DrawMs:costs.sort((a,b)=>a-b)[Math.floor(costs.length*.95)],...window.scopeFixture.state()};
          window.webkit.messageHandlers.\(message).postMessage(JSON.stringify(result));
        })().catch(error=>window.webkit.messageHandlers.failed.postMessage(String(error)));void 0
        """) { _, error in if let error = error { self.fail(String(describing: error)) } }
    }
    func processes() -> [[String: Any]] {
        let process = Process(), pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-axo", "pid=,time=,rss=,comm="]
        process.standardOutput = pipe
        do { try process.run() } catch { fail(String(describing: error)) }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return String(data: data, encoding: .utf8)!.split(separator: "\n").compactMap { line in
            let parts = line.split(maxSplits: 3, whereSeparator: { $0 == " " || $0 == "\t" })
            guard parts.count == 4, let pid = Int(parts[0]), let rss = Double(parts[2]) else { return nil }
            let seconds = parts[1].split(separator: ":").reduce(0.0) { $0 * 60 + (Double($1) ?? 0) }
            return ["pid": pid, "seconds": seconds, "workingSetKB": rss, "type": String(parts[3])]
        }
    }
    func measuredProcesses() -> [[String: Any]] {
        processes().filter { p in
            let pid = p["pid"] as! Int
            return pid == Int(ProcessInfo.processInfo.processIdentifier) ||
                (!initialPids.contains(pid) && (p["type"] as! String).contains("WebKit"))
        }
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "failed" { fail(String(describing: message.body)); return }
        if message.name == "warmed" {
            before = measuredProcesses(); started = Date()
            animate(seconds: manifest["seconds"] as? Double ?? 6, message: "done")
            return
        }
        do {
            var result = try JSONSerialization.jsonObject(with: (message.body as! String).data(using: .utf8)!) as! [String: Any]
            let run = runs[index]
            let id = run["id"] as! String, variant = run["variant"] as! String
            if benchmark {
                let elapsed = Date().timeIntervalSince(started)
                let after = measuredProcesses().map { p -> [String: Any] in
                    var value = p
                    let old = before.first { ($0["pid"] as! Int) == (p["pid"] as! Int) }?["seconds"] as? Double ?? 0
                    value["cpuMsPerSecond"] = ((p["seconds"] as! Double) - old) * 1000 / elapsed
                    return value
                }
                result["processes"] = after
                result["cpuMsPerSecond"] = after.reduce(0.0) { $0 + ($1["cpuMsPerSecond"] as! Double) }
                result["workingSetMB"] = after.reduce(0.0) { $0 + ($1["workingSetKB"] as! Double) / 1024 }
            }
            var captures = result["captures"] as? [[String: Any]] ?? []
            for i in captures.indices {
                let stem = "\(id)-\(variant)-\(captures[i]["kind"] as! String)"
                let rgba = captures[i].removeValue(forKey: "rgba") as! String
                let png = captures[i].removeValue(forKey: "png") as! String
                try Data(base64Encoded: rgba)!.write(to: output.appendingPathComponent(stem + ".rgba"))
                try Data(base64Encoded: String(png.split(separator: ",", maxSplits: 1)[1]))!.write(to: output.appendingPathComponent(stem + ".png"))
            }
            result["captures"] = captures
            result["id"] = id; result["variant"] = variant; result["config"] = run["config"]
            results.append(result)
            let filename = benchmark ? "benchmark-results.json" : "visual-results.json"
            try JSONSerialization.data(withJSONObject: ["engine": "WKWebView", "results": results], options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent(filename))
            print("\(id) \(variant) gpu=\(result["gpu"]!) cpu=\(result["cpuMsPerSecond"] ?? "visual")")
            fflush(stdout)
            if benchmark {
                // Exclude teardown from the timed interval, as in Electron.
                view.evaluateJavaScript("window.scopeFixture.dispose()") { _, error in
                    if let error = error { self.fail(String(describing: error)) }
                    self.index += 1
                    self.next()
                }
            } else {
                index += 1
                DispatchQueue.main.async { self.next() }
            }
        } catch { fail(String(describing: error)) }
    }
    func fail(_ error: String) { fputs(error + "\n", stderr); exit(1) }
}
let manifest = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [String: Any]
let application = NSApplication.shared
application.setActivationPolicy(.regular)
let runner = Runner(manifest: manifest)
runner.start()
application.run()
