#!/bin/bash
# pi-web 多实例启动脚本
# 用法: ./start-multi.sh [端口号]
# 例如: ./start-multi.sh 30142 30143 30144

PORTS=${@:-30142}

for port in $PORTS; do
    echo "启动 pi-web 实例在端口 $port..."
    nohup npx next dev -p $port > /tmp/pi-web-$port.log 2>&1 &
    echo "  PID: $!"
    echo "  URL: http://localhost:$port"
    echo ""
done

echo "所有实例已启动！"
echo "使用 'ps aux | grep next' 查看进程"
echo "使用 'kill <PID>' 停止实例"
