"""기본 실행 경로의 Python 네트워크 작업을 추가로 차단한다."""

import socket
import sys

_active = False


def enable_network_guard():
    global _active
    if _active:
        return

    def deny_network(event, args):
        if event == "socket.__new__" and args[1] in {socket.AF_INET, socket.AF_INET6}:
            raise PermissionError("이 프로그램은 오프라인 전용입니다. 인터넷 소켓 생성이 차단되었습니다.")
        if event in {"socket.connect", "socket.getaddrinfo", "socket.sendto", "socket.sendmsg"}:
            raise PermissionError("이 프로그램은 오프라인 전용입니다. 네트워크 통신이 차단되었습니다.")

    sys.addaudithook(deny_network)
    _active = True

