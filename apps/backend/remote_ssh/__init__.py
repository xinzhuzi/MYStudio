"""远端 SSH 模块(11-03 sidecar-ssh-module S1)。

paramiko 同步客户端(库选型定谳见 tasks/11-03-sidecar-ssh-module/prd.md:
asyncssh 在本机 Clash TUN 路径实弹恒死,paramiko 转正),三件分工:
  config.py  —— ssh-remote.json 原子读写(照 remote-engine.json 范式)
  service.py —— SSHService 单例:keeper 保活 + SFTP 令牌自愈(禁远程 exec)
  tunnel.py  —— direct-tcpip + select 双向泵本地转发(默认 17596)

fail-open 铁律:paramiko 未装(needs-runtime 态)时本模块一切入口只降级
不拦截,sidecar 照常启动,令牌链回落现行为文件/env。
"""
