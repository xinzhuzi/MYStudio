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
        // 1007 用户令:预览跨重启持久化——serialize=true 文本随 widgets_values 落盘,
        // 载入时框架按位预填(运行期仍由 onExecuted 覆盖)。原「serialize=false 不
        // 污染序列化」作废;api_key 控件的 serialize=false 是密钥不落盘,另一回事勿动。
        w.serialize = true;
        // 旧存档(serialize=false 时代)widgets_values 缺本槽位——框架按位填充可能
        // 留 undefined,显式归 ""(onConfigure 在 widgets_values 应用后跑)。
        const origConfigure = node.onConfigure;
        node.onConfigure = function (...a) {
            const r = origConfigure?.apply(this, a);
            const pw = (this.widgets || []).find((x) => x.__myPreviewDisplay);
            if (pw && (pw.value === undefined || pw.value === null)) pw.value = "";
            return r;
        };
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

// 1007:服务健康状态上画布——onExecuted 读 ui.api_pe_status(双形态载荷:直挂或
// output 内挂,同上兼容):透传(服务不可达/答文解析失败)→节点标红+标题警示;
// AI 扩写正常→复原。零新增槽位(终稿文本仍看 [4014]),只解决"服务挂了看不出来"
// (1006 十型终审 3 发静默透传的体验痛点)。
app.registerExtension({
    name: "MY.qi21_api_pe_status",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "MyQi21ApiPE") return;
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            const payload = message && (message.output || message);
            const arr = payload && payload.api_pe_status ? payload.api_pe_status
                : message && message.api_pe_status ? message.api_pe_status : null;
            const status = arr ? String(arr[0] ?? "") : "";
            if (!status) return;
            if (this._myTitle0 === undefined) this._myTitle0 = this.title;
            if (status.startsWith("透传") || status.startsWith("云端失败")) {
                this.title = this._myTitle0 + " ⚠" + status;
                this.bgcolor = "#4a2020";
            } else {
                this.title = this._myTitle0;
                this.bgcolor = null;
            }
            this.setDirtyCanvas(true, true);
        };
    },
});

// 1006 批A:MyQi21BasesText(真源文本)节点上一只只读多行展示框「内容」——
// onExecuted 把 ui.bases_text(双形态载荷:直挂或 output 内挂,同上兼容)落框;
// 载荷缺位不清框(Q4 决议:会话内不丢)
app.registerExtension({
    name: "MY.qi21_bases_text_display",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!["MyQi21BasesText","MyQi21系统提示词","MyQi21色卡","MyQi21美术风格底座"].includes(nodeData.name)) return;
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

// 1007:云端 api_key 密码控件(用户令「UI控件输入apikey,需要加密」)——
// 掩码显示(inputEl type=password)+ serialize=false(不进 widgets_values=不落
// 工作流文件)+ onChange POST 引擎侧 /my-nodes/qi21-pe-key(存引擎进程内存,
// 不进 /prompt JSON→不进 PNG 元数据)+ 引擎重启即失(钥匙串兜底)。
// key 全链路零明文落盘:仓库/工作流/PNG 三处均无;控件值为空=走钥匙串/env。
app.registerExtension({
    name: "MY.qi21_api_pe_key",
    async nodeCreated(node) {
        if (node.comfyClass !== "MyQi21ApiPE") return;
        if ((node.widgets || []).some((x) => x.name === "api_key")) return;
        // 1007 两轮实勘定谳:①customtext+multiline:false 无 DOM(面板不可见);
        // ②addDOMWidget 懒元素在 loadGraphData 期 computeLayoutSize 读
        // this.element=getComputedStyle(undefined)→整个装载炸(「打开失败」)。
        // 修法=框架 customtext 封装同款官方模式:元素先造,addDOMWidget 后
        // 立即 w.element=el 饿汉挂载(computeLayoutSize 出生即有元素)。
        const post = (v) => {
            try {
                fetch("/my-nodes/qi21-pe-key", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ key: String(v ?? "") }),
                }).catch(() => {});
            } catch { /* 探针环境无 fetch 时静默 */ }
        };
        const el = document.createElement("input");
        el.type = "password";
        el.autocomplete = "off";
        el.spellcheck = false;
            el.placeholder = "填=本次走云端glm-5.3-flash(最高思考);留空=本地LM Studio;仅存内存不入盘";
        el.style.width = "100%";
        el.style.boxSizing = "border-box";
        el.style.backgroundColor = "var(--comfy-input-bg, #222)";
        el.style.color = "var(--input-text, #ddd)";
        el.style.border = "1px solid var(--border-color, #444)";
        el.style.borderRadius = "4px";
        el.style.padding = "4px 8px";
        const w = node.addDOMWidget("api_key", "password", () => el, {
            getValue: () => el.value,
            setValue: (v) => { el.value = v ?? ""; },
            // 单行钉死(与 api_url 同款行高):分离元素的 --comfy-widget-* 变量
            // 读出来是空→parseInt NaN→布局放飞成巨框(1007 用户实拍),给死值。
            getMinHeight: () => 38,
            getMaxHeight: () => 38,
            getHeight: () => 38,
            minNodeSize: [300, 40],
        });
        w.element = el; // ★ 饿汉挂载:装载期 computeLayoutSize 即有元素
        w.serialize = false;
        el.addEventListener("change", () => post(el.value));
        el.addEventListener("blur", () => post(el.value));
    },
});
