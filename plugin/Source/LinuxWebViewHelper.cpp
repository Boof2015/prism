// Loaded as a separate executable, before the plugin or any GTK/GLib libraries.
#include <cstdio>
#include <cstdlib>
#include <dlfcn.h>
#include <unistd.h>

int main(int argc, char** argv)
{
    // The dynamic linker caches LD_LIBRARY_PATH at process startup. Unsetting
    // it alone is insufficient; re-exec before dlopen to discard host overrides.
    // This changes only the browser helper, never the DAW's environment.
    if (std::getenv("LD_LIBRARY_PATH") != nullptr || std::getenv("LD_PRELOAD") != nullptr)
    {
        unsetenv("LD_LIBRARY_PATH");
        unsetenv("LD_PRELOAD");
        execv("/proc/self/exe", argv);
        std::perror("Prism WebView: re-exec failed");
        return 1;
    }

    if (argc < 3)
        return 1;

    auto* library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    if (library == nullptr)
    {
        std::fprintf(stderr, "Prism WebView: %s\n", dlerror());
        return 1;
    }

    auto* entry = reinterpret_cast<int (*)(int, const char* const*)>(dlsym(library, argv[2]));
    if (entry == nullptr)
    {
        std::fprintf(stderr, "Prism WebView: %s\n", dlerror());
        return 1;
    }

    return entry(argc - 3, argv + 3);
}
