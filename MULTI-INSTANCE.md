# pi-web 多实例运行指南

## 问题
同时打开多个 pi-web 标签页时，它们会共享同一个 Node.js 进程的内存，可能导致内存溢出。

## 解决方案
在不同端口运行多个独立的 pi-web 实例，每个实例有独立的内存空间。

## 快速开始

### 方法 1: 使用管理脚本 (推荐)

#### PowerShell (Windows 推荐)
```powershell
# 启动多个实例
.\pi-web-manager.ps1 start 30142 30143 30144

# 查看状态
.\pi-web-manager.ps1 status

# 停止指定实例
.\pi-web-manager.ps1 stop 30142

# 停止所有实例
.\pi-web-manager.ps1 stop-all

# 重启指定实例
.\pi-web-manager.ps1 restart 30142
```

#### CMD (Windows)
```cmd
pi-web-manager.bat start 30142 30143 30144
pi-web-manager.bat status
```

#### Bash (Linux/Mac)
```bash
# 启动多个实例
./start-multi.sh 30142 30143 30144

# 查看状态
ps aux | grep next

# 停止实例
kill <PID>
```

### 方法 2: 手动启动

```bash
# 实例 1
npx next dev -p 30142

# 实例 2 (新终端)
npx next dev -p 30143

# 实例 3 (新终端)
npx next dev -p 30144
```

## 使用建议

1. **每个项目一个实例**: 为不同的项目使用不同的端口
   - 项目 A: http://localhost:30142
   - 项目 B: http://localhost:30143
   - 项目 C: http://localhost:30144

2. **收藏夹管理**: 在浏览器中收藏不同端口的地址
   - 收藏 http://localhost:30142 → "pi-web 项目 A"
   - 收藏 http://localhost:30143 → "pi-web 项目 B"

3. **资源监控**: 使用 `pi-web-manager.ps1 status` 查看所有实例状态

## 端口范围建议

- 30142-30150: pi-web 实例
- 避免使用 30141 (默认开发端口)

## 故障排除

### 端口被占用
```powershell
# 查看端口占用
netstat -ano | findstr :30142

# 停止占用进程
taskkill /PID <PID> /F
```

### 内存不足
- 减少同时运行的实例数量
- 定期重启实例
- 监控系统内存使用
