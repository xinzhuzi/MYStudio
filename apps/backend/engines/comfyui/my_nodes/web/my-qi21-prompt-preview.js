// 漫影 qi21 正负双预览显示扩展(1005 ㊈)
// MyQi21PromptPreview 是 OUTPUT_NODE,但前端不渲染字符串返回值;本扩展在节点上
// 挂一只只读 multiline 显示框,onExecuted 时把 ui.merged(正/负分区合并文)落框
// 并自适应尺寸。参照 pysssss showText.js 同款机制;零改 ComfyUI 本体。
import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "MY.Qi21PromptPreview",
    async nodeCreated(node) {
        if (node.comfyClass !== "MyQi21PromptPreview") return;
        const w = node.addWidget("customtext", "合并预览", "", () => {}, { multiline: true });
        w.__myPreviewDisplay = true;
        w.serialize = false;           // 不进 widgets_values,不污染序列化
        if (w.inputEl) {
            w.inputEl.readOnly = true;
            w.inputEl.style.opacity = 0.85;
            w.inputEl.placeholder = "排队运行一次后,此处显示正向/负向终稿";
        }
    },
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "MyQi21PromptPreview") return;
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            // 前端版本差异:有的传 ui 载荷(message.merged),有的传整个 detail
            // (message.output.merged)——两种形态都吃(1005 实弹定谳:前者取不到
            // 时 text 落成空串,框被"清空",正是当晚首跑实弹所见)。
            const payload = message && message.merged ? message
                : message && message.output && message.output.merged ? message.output
                : null;
            const merged = (payload && payload.merged) || [""];
            const text = String(merged[0] ?? "");
            const w = (this.widgets || []).find((x) => x.__myPreviewDisplay);
            if (!w) return;
            w.value = text;
            requestAnimationFrame(() => {
                const sz = this.computeSize();
                this.onResize?.([Math.max(this.size[0], sz[0]), Math.max(this.size[1], sz[1])]);
                app.graph.setDirtyCanvas(true, false);
            });
        };
    },
});

// 1006 四轮:MyQi21ApiPE(AI扩写)节点上两只只读多行展示框——onExecuted 把
// ui.api_pe_pos/api_pe_neg(双形态载荷:直挂或 output 内挂,同上兼容)落框
app.registerExtension({
    name: "MY.qi21_api_pe_display",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "MyQi21ApiPE") return;
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            const payload = message && (message.output || message);
            const pos = payload && payload.api_pe_pos ? payload.api_pe_pos
                : message && message.api_pe_pos ? message.api_pe_pos : null;
            const neg = payload && payload.api_pe_neg ? payload.api_pe_neg
                : message && message.api_pe_neg ? message.api_pe_neg : null;
            const setBox = (names, arr) => {
                if (!arr) return;
                const w = (this.widgets || []).find((x) => names.includes(x.name));
                if (!w) return;
                w.value = String(arr[0] ?? "");
            };
            setBox(["正向扩写全文"], pos);
            setBox(["负向扩写清单"], neg);
        };
    },
});

// 1006 批A:MyQi21BasesText(真源文本)节点上一只只读多行展示框「内容」——
// onExecuted 把 ui.bases_text(双形态载荷:直挂或 output 内挂,同上兼容)落框;
// 载荷缺位不清框(Q4 决议:会话内不丢)
app.registerExtension({
    name: "MY.qi21_bases_text_display",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "MyQi21BasesText") return;
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            const payload = message && (message.output || message);
            const arr = payload && payload.bases_text ? payload.bases_text
                : message && message.bases_text ? message.bases_text : null;
            if (!arr) return;
            const w = (this.widgets || []).find((x) => x.name === "内容");
            if (!w) return;
            w.value = String(arr[0] ?? "");
        };
    },
});
