#include <cstdlib>
#include <cstring>
#include <dlfcn.h>
#include <unistd.h>

extern "C" int prismWebViewHelperProbe(int argc, const char* const* argv)
{
    if (std::getenv("LD_LIBRARY_PATH") != nullptr || std::getenv("LD_PRELOAD") != nullptr)
        return 1;
    if (argc != 3 || std::strcmp(argv[0], "argument with spaces") != 0
                  || std::strcmp(argv[1], "second") != 0)
        return 2;
    if (access(argv[2], R_OK) != 0)
        return 3;
    // Merely unsetting the variables leaves both the preloaded library and the
    // linker's startup search path in place. Only a clean exec passes this.
    if (dlopen("libprism_host_override.so", RTLD_NOW | RTLD_LOCAL) != nullptr)
        return 4;
    return 0;
}
