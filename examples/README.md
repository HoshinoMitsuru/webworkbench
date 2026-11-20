# 示例数据

这里的文件只用于**试用与接口调试**，不属于内容工作台的工程代码：

- 不会被 `workbench/` 的构建产物包含；
- 不会被工作台当作真实活动写入活动库；
- 生产部署不需要这个目录，删掉不影响任何功能。

## 文件

| 文件 | 用途 |
|---|---|
| `activity.sample.json` | 一份虚构的活动资料，字段与「活动资料」表单一致 |

工作台「载入示例资料」按钮会读取这个文件；文件不存在时，按钮自动隐藏。也就是说：示例是否出现，由运维决定，而不是写死在代码里。

## 直接调接口

先在浏览器登录工作台，然后从开发者工具复制 Cookie，或用下面的命令先换一个会话：

```bash
# 1. 登录（用户名/密码替换成你的账号）
curl -s -c cookie.txt -H "Content-Type: application/json" \
  -d '{"username":"zhangsan","password":"Passw0rd2026"}' \
  http://localhost:3000/api/auth/login

# 2. 用示例数据生成内容
curl -s -b cookie.txt -H "Content-Type: application/json" \
  -d "{\"activity\": $(cat activity.sample.json)}" \
  http://localhost:3000/api/generate

# 3. 把示例数据保存到共享活动库
curl -s -b cookie.txt -H "Content-Type: application/json" \
  -d "{\"data\": $(cat activity.sample.json)}" \
  http://localhost:3000/api/activities
```

（Windows PowerShell 用 `curl.exe`；`$(cat ...)` 换成 `Get-Content activity.sample.json -Raw`。）

## 在生产环境临时放示例

默认不部署示例。如果需要在 ECS 上给同事演示，把本目录挂进容器即可：

```yaml
# docker-compose.yml 的 app 服务下追加
volumes:
  - ./data:/app/data
  - ../examples:/app/examples:ro
```

同时把 `examples/` 一起上传到 ECS 的项目上级目录。

## 换一份更贴近真实的示例

直接编辑 `activity.sample.json` 即可，字段含义见 `workbench/lib/types.ts` 中的 `ActivityInput`。
**注意：示例会被任何人看到，不要填入真实学员姓名、联系方式或未公开活动信息。**
