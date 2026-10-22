# AGENT.md

> 这份文档由你(ramify 形态里的 agent)维护,写给下一次的你自己。结构变了、加了功能、定了约定、踩了坑,就改这里。
> 每一个生成批次你都会读到它,写错了下一次的你就会被带偏。下面是出厂时的样子。

## 这是什么

ramify 是 iimos 的一个形态:整个窗口就是一块创意画布。用户写一句需求、选方案数量,你一次生成 N 个方向不同的作品
(HTML / Markdown / SVG),每个作品是树上的一个节点,卡片能预览;用户点任一节点的「发散」写修改要求,就从那个节点
继续长分支,旧方案不动。模型用用户自己的(BYOK),配置在 `$IIMOS_DATA/config.json`。

和出厂形态不同,这里**没有自由对话**:每次生成是一个独立的 agent 循环(一个 run),带着任务说明和三个工具跑完就结束。
用户在画布上写的是作品需求,不是改你自己的要求。

## 目录

```text
main.js             入口(纯 Node):起本地服务 → globalThis.iimos.ready({ url, window })
server/
  index.js          本地 HTTP 服务(只听 127.0.0.1,每个请求要令牌):托管 ui/,/api 分发,SSE 事件流
  config.js         $IIMOS_DATA/config.json 读写:responsesUrl / apiKey / model 三项是契约定的,别的形态写的字段原样保留
  db.js             node:sqlite,$IIMOS_DATA/ramify/ramify.db:projects / nodes / runs 三张表,建表语句在这里,不写迁移
  render.js         节点内容 → 完整 HTML(markdown 走 vendor/marked.js,svg 居中放在纸上)
  runs.js           生成批次:建占位节点、拼任务说明、起 agent 循环、把事件推给界面;多个批次可以同时跑
  instructions.js   模型指令 = agent/prompt.md + 本文件,每个批次现读
  agent/            Agent 循环(从出厂应用复制,只管「模型 → 工具 → 模型」,不碰存储)
    index.js        run():模型、压缩、工具循环,九种事件
    tools.js        三个工具的定义:write_node、read_tree、shell
    runner.js       按名字分发到 functions/
    functions/nodes.js   write_node / read_tree 的实现(通过 config.canvas 拿到数据库和当前项目)
    functions/shell.js   出厂的 shell
    compact.js      上下文压缩(长批次才会触发)
    prompt.md       你的角色提示词
  ai/index.js       模型请求(Responses 流式),网络失败 / 429 / 5xx 自动重试两次
  vendor/marked.js  Markdown 渲染(从 esm.sh 打的单文件,服务端没有 npm)
ui/                 界面:React + TSX,iimos build 编译到 ui/dist(产物进 git,回滚瞬间可用)
  src/App.tsx       两屏:首页 #/ 和画布 #/p/<id>;模型配置浮层
  src/store.ts      GET /api/state 拿全量,SSE 接 node / run / log / config 事件
  src/components/   Home(输入框 + 数量 + 历史画布)、Canvas(树)、NodeCard、Bubble(发散气泡)、Preview、Minimap、Activity、Setup
  src/lib/          layout.ts 横向树布局(节点尺寸要和 style.css 一致)、viewport.ts 平移缩放
  vendor/           iimos add 装的第三方库(出厂没有)
test/               node --test,假模型跑完整个流程;launcher 播种时不带这个目录
```

## 数据

- 节点只有一种,`type` 决定内容:`text` 是标题节点(根 = 需求,每次发散的「轮」= 修改要求,content 为空);
  `html / markdown / svg` 是作品,content 是完整源码,NULL 表示生成中;`error` 的 content 是失败原因。
- `parent_id + position` 定树形。发散时先在被选中的节点下插一个轮节点,占位作品挂在轮下面 —— 旧节点一个都不动。
- 批次(run)结束时,这一批还空着的占位节点会被标成 error;进程重启时还在「running」的批次一律标失败。

## 约定

- 作品一律用 `write_node` 写进节点;`shell` 只用来查资料、算东西、看源码。
- 任务说明里给了占位节点的 id;分叉任务里带着父节点的完整内容和整棵树的大纲,想看别的节点用 `read_tree`。
- 缩略图 iframe 用 `sandbox=""`(不跑脚本),右侧预览用 `sandbox="allow-scripts"`(不给 same-origin,脚本拿不到令牌)。
- `config.json` 所有形态共用:responsesUrl / apiKey / model 别改意思,别的字段原样保留。
- 加工具:tools.js 加定义 + functions/ 加实现 + runner.js 加分发,然后 `iimos restart`。
- 加前端库:`iimos add <包>`,之后照常 import。React 不用装。

## 验证

```sh
npm test       # 服务端测试(假模型,不联网;需要 node 22.5+)
iimos build    # 编译界面
```

改了 server/ 或 main.js 要 `iimos restart`;只改了 ui/ 用 `iimos reload`。每改完一件事 `iimos snapshot "说明"`。
