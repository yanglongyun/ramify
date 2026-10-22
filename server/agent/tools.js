// 工具定义。三个:shell(出厂自带)、write_node(写入 / 更新一个节点)、read_tree(读整棵树)。
// 加工具:这里加定义,functions/ 加实现,runner.js 加分发。
const tools = [
    {
        type: 'function',
        name: 'write_node',
        description: '把一份作品写进画布上的一个节点(或覆盖它)。content 必须是完整的、能独立打开的源码:'
            + 'html 是整页 HTML(内联 CSS / JS,不依赖本地文件);markdown 是正文;svg 是一个完整的 <svg> 元素。'
            + '做不出来时 type 填 error,content 写原因。',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '节点 id(占位节点的 id 在任务里给了)' },
                title: { type: 'string', description: '方案名,一眼能看出这版和别的版有什么不同,不超过 20 字' },
                type: { type: 'string', enum: ['html', 'markdown', 'svg', 'error'], description: '作品类型' },
                content: { type: 'string', description: '完整源码;error 时是失败原因' },
            },
            required: ['id', 'title', 'type', 'content'],
        },
    },
    {
        type: 'function',
        name: 'read_tree',
        description: '读项目的整棵树:每个节点的 id、父节点、类型、标题、状态。node_ids 里列出的节点会连完整内容一起返回。',
        parameters: {
            type: 'object',
            properties: {
                project_id: { type: 'string', description: '项目 id' },
                node_ids: { type: 'array', items: { type: 'string' }, description: '要看完整内容的节点 id(可选)' },
            },
            required: ['project_id'],
        },
    },
    {
        type: 'function',
        name: 'shell',
        description: '在 workspace(形态自己的目录)里执行终端命令,返回合并输出与退出码。'
            + '需要查资料(curl)、算东西、检查源码时用;作品本身请用 write_node 写进节点。',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: '终端命令' },
                workdir: { type: 'string', description: '可选工作目录,相对 workspace' },
            },
            required: ['command'],
        },
    },
];

export default tools;
