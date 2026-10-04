/* Native capability evidence only. Never enables execution or changes the host. */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>

static int file(const char *path, const char *bytes) {
    int fd = open(path, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0600);
    if (fd < 0) return -1;
    int ok = write(fd, bytes, strlen(bytes)) == (ssize_t)strlen(bytes);
    close(fd);
    return ok ? 0 : -1;
}

static int readable(const char *path) {
    int fd = open(path, O_RDONLY | O_NOFOLLOW);
    if (fd < 0) return 0;
    char byte;
    int ok = read(fd, &byte, 1) == 1;
    close(fd);
    return ok;
}

static int staged_filesystem(void) {
    char root[] = "/tmp/clack-landlock.XXXXXX";
    if (!mkdtemp(root)) return 10;
    char stage[256], input[256], original[256], secret[256], alias[256], made[256], sym[256], relative[256];
    snprintf(stage, sizeof(stage), "%s/stage", root);
    snprintf(input, sizeof(input), "%s/stage/input.txt", root);
    snprintf(original, sizeof(original), "%s/original.txt", root);
    snprintf(secret, sizeof(secret), "%s/.env", root);
    snprintf(alias, sizeof(alias), "%s/innocent.txt", root);
    snprintf(made, sizeof(made), "%s/stage/made.txt", root);
    snprintf(sym, sizeof(sym), "%s/stage/symlink", root);
    snprintf(relative, sizeof(relative), "../.env");
    int status = 0;
    if (mkdir(stage, 0700) || file(input, "approved") || file(original, "approved") ||
        file(secret, "SECRET_CANARY") || link(secret, alias)) return 11;
    struct stat a, b;
    if (stat(input, &a) || stat(original, &b) || a.st_ino == b.st_ino || a.st_nlink != 1) return 12;
    pid_t child = fork();
    if (child == 0) {
        struct landlock_ruleset_attr rules = {.handled_access_fs = (1ULL << 15) - 1};
        int fd = syscall(SYS_landlock_create_ruleset, &rules, sizeof(rules), 0);
        int directory = open(stage, O_PATH | O_DIRECTORY | O_CLOEXEC);
        struct landlock_path_beneath_attr path = {
            .allowed_access = rules.handled_access_fs, .parent_fd = directory
        };
        if (fd < 0 || directory < 0 || syscall(SYS_landlock_add_rule, fd, LANDLOCK_RULE_PATH_BENEATH, &path, 0) ||
            chdir(stage) || prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) ||
            syscall(SYS_landlock_restrict_self, fd, 0)) _exit(13);
        close(fd); close(directory);
        if (!readable("input.txt") || readable(original) || readable(secret) || readable(alias) || readable(relative)) _exit(14);
        if (!link(secret, made)) _exit(15);
        if (symlink(secret, sym)) _exit(16);
        /* Follow this attacker-created link, so O_NOFOLLOW cannot mask a leak. */
        int escape = open(sym, O_RDONLY);
        if (escape >= 0) {close(escape); _exit(17);}
        pid_t descendant = fork();
        if (descendant == 0) _exit(readable(secret) ? 18 : 0);
        if (descendant < 0 || waitpid(descendant, &status, 0) != descendant || status != 0) _exit(19);
        _exit(0);
    }
    int ok = child > 0 && waitpid(child, &status, 0) == child && WIFEXITED(status) && WEXITSTATUS(status) == 0;
    int preserved = readable(secret) && readable(original);
    /* Only exact fixture paths, never recursive traversal of a child-made link. */
    unlink(sym); unlink(made); unlink(input); unlink(alias); unlink(secret); unlink(original);
    int cleaned = rmdir(stage) == 0 && rmdir(root) == 0;
    printf("staging_independent=1 landlock_fixture=%s source_preserved=%d cleanup=%d child_status=%d\n",
        ok ? "passed" : "failed", preserved, cleaned, status);
    return ok && preserved && cleaned ? 0 : 20;
}

int main(void) {
    if (geteuid() == 0) return 2;
    errno = 0;
    long abi = syscall(SYS_landlock_create_ruleset, NULL, 0, 1);
    printf("landlock_abi=%ld errno=%d uid=%d\n", abi, errno, getuid());
    fflush(stdout);
    if (abi >= 3) {
        int fs = staged_filesystem();
        if (fs) return fs;
        fflush(stdout);
    }
    pid_t pid = fork();
    if (pid < 0) return 3;
    if (pid == 0) {
        /* This finite trusted fixture tests only one primitive, not a complete
           syscall policy or a production Linux confinement backend. */
        struct sock_filter code[] = {
            BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
            BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_socket, 0, 1),
            BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EACCES),
            BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
        };
        struct sock_fprog filter = {sizeof(code) / sizeof(code[0]), code};
        if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) ||
            prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &filter)) _exit(4);
        int tcp = socket(AF_INET, SOCK_STREAM, 0);
        int tcp_error = errno;
        int udp = socket(AF_INET, SOCK_DGRAM, 0);
        int udp_error = errno;
        printf("no_new_privs=1 tcp=%d/%d udp=%d/%d\n", tcp, tcp_error, udp, udp_error);
        fflush(stdout);
        _exit(tcp == -1 && udp == -1 && tcp_error == EACCES && udp_error == EACCES ? 0 : 5);
    }
    int status;
    if (waitpid(pid, &status, 0) != pid || !WIFEXITED(status)) return 6;
    return WEXITSTATUS(status);
}
