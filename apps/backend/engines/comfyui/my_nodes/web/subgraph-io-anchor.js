// 漫影子图出口销锚定(1007 用户令「输出 port 须在输入 port 右侧,且有一定距离」):
// 虚拟 -20 出口节点(SubgraphOutputNode)装载推导位=最右节点 pos.x+50,必落最右节点
// 身位内(节点宽>50 即中招)→ 边界连线从右往左倒着走,违「输出口最右/恒向右」铁律
// (优化集 OPTIMIZATION.md 布局③流向纪律/④优先级序;文件布局无法修复——推导公式含 pos.x 必然内落)。
// 本扩展=该铁律的运行时执行者:看门狗轻检活动子图,出口销 x 低于「最右节点右缘+80」
// 时锚定到下限;用户手拖到更右的位置不回拉(只补下限不锁死)。零改 ComfyUI 本体。
import { app } from "../../scripts/app.js";

const MARGIN = 80;      // 出口销与最右节点右缘的最小距离(用户令「有一定距离」)
const INTERVAL = 600;   // 看门狗周期 ms(画布怠速不重绘,错位时由本钩子强绘)

function anchorOutputNode(sg) {
    if (!sg || !sg.outputs || !sg.outputs.length) return false;
    const onode =
        (sg._nodes || []).find((n) => n.id === -20 || n.id === "-20") ||
        (sg._nodes_by_id && (sg._nodes_by_id["-20"] || sg._nodes_by_id[-20])) ||
        sg.outputNode;
    if (!onode || !onode.pos) return false;
    let rightEdge = 0;
    for (const n of sg._nodes || []) {
        if (n.id === -20 || n.id === "-20") continue;
        rightEdge = Math.max(rightEdge, n.pos[0] + (n.size ? n.size[0] : 200));
    }
    const floorX = rightEdge + MARGIN;
    if (onode.pos[0] >= floorX) return false; // 已合规(含用户手拖更右),不动
    onode.pos[0] = floorX;
    if (onode.boundingRect) onode.boundingRect[0] = floorX;
    try { onode.arrange && onode.arrange(); } catch {}
    return true;
}

app.registerExtension({
    name: "MY.subgraph_io_anchor",
    setup() {
        setInterval(() => {
            try {
                const sg = app.canvas && app.canvas.graph;
                if (sg && anchorOutputNode(sg)) {
                    try { app.canvas.draw(true, true); } catch {}
                }
            } catch {}
        }, INTERVAL);
    },
});
