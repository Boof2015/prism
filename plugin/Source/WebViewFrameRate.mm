#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#include "WebViewFrameRate.h"

// Private WebKit API. +_features is a CLASS method; the enable setter is an
// instance method. Guarded by respondsToSelector so this degrades to a no-op if
// the private API changes.
@interface WKPreferences (PrismPrivate)
+ (NSArray *)_features;
- (void)_setEnabled:(BOOL)enabled forFeature:(id)feature;
@end

static WKWebView* prismFindWebView(NSView* view)
{
    if (view == nil)
        return nil;
    if ([view isKindOfClass:[WKWebView class]])
        return (WKWebView*) view;
    for (NSView* sub in [view subviews])
        if (WKWebView* found = prismFindWebView(sub))
            return found;
    return nil;
}

bool prismUncapWebViewFrameRate(void* nsViewHandle)
{
    WKWebView* webView = (nsViewHandle != nullptr) ? prismFindWebView((NSView*) nsViewHandle) : nil;

    // Fallback: search every app window's content view.
    if (webView == nil)
        for (NSWindow* win in [NSApp windows])
            if ((webView = prismFindWebView([win contentView])) != nil)
                break;

    if (webView == nil)
        return false; // not in the hierarchy yet — caller retries

    WKPreferences* prefs = [[webView configuration] preferences];
    if (prefs == nil
        || ! [WKPreferences respondsToSelector:@selector(_features)]
        || ! [prefs respondsToSelector:@selector(_setEnabled:forFeature:)])
        return false;

    // Disable WebKit's private "prefer ~60fps page rendering" throttle so the
    // canvas repaints at the display's native rate (e.g. 120Hz). Applied live:
    // a reload is NOT used because JUCE's resource provider doesn't re-serve on
    // reload (which would blank the page). The preference syncs to the WebContent
    // process and takes effect on the running page.
    for (id feature in [WKPreferences _features])
    {
        NSString* key = nil;
        @try { key = [feature valueForKey:@"key"]; }
        @catch (NSException*) { key = nil; }

        if ([key isEqualToString:@"PreferPageRenderingUpdatesNear60FPSEnabled"])
        {
            [prefs _setEnabled:NO forFeature:feature];
            return true;
        }
    }
    return false;
}
