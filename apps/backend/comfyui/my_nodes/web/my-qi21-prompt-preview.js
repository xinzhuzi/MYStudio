// 漫影 qi21 正负双预览显示扩展(1005 ㊈;1007晚 终态=py-DOM 同构)
// MyQi21PromptPreview 是 OUTPUT_NODE,但前端不渲染字符串返回值;显示位=
// py 端 optional multiline「正向终稿/负向终稿」(DOMWidgetImpl 可靠路径),
// 本扩展 onExecuted 按 name 把 ui.positive/ui.negative 分键写进各框。
// 零改 ComfyUI 本体。
//
// 1007深夜二轮(用户令「正负提示词都传入了,但是又多了个渲染控件,布局也
// 不合理」):单「预览显示」合并框退役——正/负各自成框,框数=2 零多余控件,
// 与件名「提示词预览(正向+负向)」字面一致;框钉只读展示面板(readOnly+
// 占位文案+钉高,吸收并行会话单框版同款打磨)。
//
// 1007 定谳存档:JS customtext/addDOMWidget 走新前端 LegacyWidget 兼容层,
// element 懒 materialize 无可靠可见渲染(三方案试毕全败)——显示位已撤到
// py 端,勿再走 JS 自建 widget 路线。
import { app } from "../../scripts/app.js";

// 显示框钉只读展示面板:readOnly+占位文案+钉高(两框各半,合计≈原单框高;
// onConfigure 载入预填后同样保持只读态)。
app.registerExtension({
    name: "MY.Qi21PromptPreview",
    async nodeCreated(node) {
        if (node.comfyClass !== "MyQi21PromptPreview") return;
        const pin = (name, hint) => {
            const w = (node.widgets || []).find((x) => x.name === name);
            if (!w) return;
            const el = w.inputEl ?? w.element;
            if (!el) return;
            el.readOnly = true;
            el.spellcheck = false;
            el.placeholder = hint;
            el.style.minHeight = "245px";
            el.style.overflow = "auto";
        };
        pin("正向终稿", "跑一发后此处显示正向终稿");
        pin("负向终稿", "跑一发后此处显示负向终稿");
    },
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "MyQi21PromptPreview") return;
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            // 前端版本差异:载荷直挂(message.positive)或整体 detail
            // (message.output.positive)——两种形态都吃(1005 实弹定谳沿用)。
            const payload = message && (message.output || message);
            const fill = (widgetName, arr) => {
                if (!arr) return; // 载荷缺位不清框(1005 实弹定谳:清框正是当晚所见)
                const text = String(arr[0] ?? "");
                const w = (this.widgets || []).find((x) => x.name === widgetName);
                if (!w) return;
                w.value = text;
                // DOM 直写+input 事件派发(Vue v-model 同步)——数据层与像素层双写
                const el = w.inputEl || w.element;
                if (el && el.value !== undefined) {
                    el.value = text;
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                }
            };
            fill("正向终稿", payload && payload.positive);
            fill("负向终稿", payload && payload.negative);
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

// 真源展示：美术风格底座只显示画法与风格负向。背景、光照与状态在类型句。
app.registerExtension({
    name: "MY.qi21_bases_text_display",
    async nodeCreated(node) {
        if (node.comfyClass !== "MyQi21美术风格底座") return;
        for (const name of ["美术风格", "负向词表"]) {
            const w = (node.widgets || []).find(x => x.name === name);
            const el = w?.inputEl ?? w?.element;
            if (!el) continue;
            el.readOnly = true;
            el.spellcheck = false;
            el.placeholder = "真源" + name + "（执行后刷新）";
            el.style.minHeight = "140px";
            el.style.overflow = "auto";
        }
        node.size = [Math.max(node.size?.[0] ?? 0, 560), 400];
        node.onResize?.(node.size);
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!["MyQi21BasesText", "MyQi21系统提示词", "MyQi21色卡", "MyQi21美术风格底座"].includes(nodeData.name)) return;
        const put = (node, name, value) => {
            const w = (node.widgets || []).find(x => x.name === name);
            if (!w) return;
            w.value = String(value ?? "");
            const el = w.inputEl ?? w.element;
            if (el && el.value !== undefined) {
                el.value = w.value;
                el.dispatchEvent(new Event("input", {bubbles: true}));
            }
        };
        const isStyle = nodeData.name === "MyQi21美术风格底座";
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            const payload = message?.output?.merged || message?.merged || message?.output || message;
            const fill = (name, key) => {
                const values = payload?.[key] ?? message?.[key];
                if (values) put(this, name, values[0]);
            };
            fill(isStyle ? "美术风格" : "内容", "bases_text");
            if (isStyle) fill("负向词表", "bases_text_negative");
        };
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            onConfigure?.apply(this, arguments);
            if (!isStyle) {
                // 旧通用节点的退役拆件下拉值改回风格节，不能再显示背景出口。
                const section = (this.widgets || []).find(x => x.name === "文本节");
                if (section && ["风格工艺件", "底色背景件", "透明承载件"].includes(section.value)) {
                    put(this, "文本节", "美术风格底座");
                    put(this, "内容", "");
                }
                return;
            }
            // 旧5/4/2值快照仅为展示。按新schema真源默认值重填，绝不按旧位置沿用。
            const migrated = info?.properties?.qi21StyleSchema !== 2;
            for (const name of ["美术风格", "负向词表"]) {
                const w = (this.widgets || []).find(x => x.name === name);
                const value = migrated ? nodeData.input?.optional?.[name]?.[1]?.default : w?.value;
                put(this, name, value);
            }
            this.properties = {...this.properties, qi21StyleSchema: 2};
            this.size = [Math.max(this.size?.[0] ?? 0, 560), 400];
            this.onResize?.(this.size);
        };
        if (isStyle) {
            const onSerialize = nodeType.prototype.onSerialize;
            nodeType.prototype.onSerialize = function (info) {
                onSerialize?.apply(this, arguments);
                const names = ["美术风格", "负向词表"];
                const named = Object.fromEntries(names.map(name => [name,
                    String((this.widgets || []).find(x => x.name === name)?.value ?? "")]));
                info.widgets_values = names.map(name => named[name]);
                info.widgets_values_named = named;
                info.properties = {...info.properties, qi21StyleSchema: 2};
            };
        }
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
            // 执行图闸(1007 晚泄密勘误):前端两套序列化分权(executionUtil.ts
            // 原注释:"widget.options.serialize controls prompt inclusion /
            // widget.serialize controls workflow persistence")——只设
            // w.serialize=false 时控件现值仍随 /prompt 提交,SaveImage 把
            // 执行图逐字刻进 PNG 元数据(00010/00011 实泄 key 明文)。
            serialize: false,
        });
        w.element = el; // ★ 饿汉挂载:装载期 computeLayoutSize 即有元素
        w.serialize = false; // 工作流闸(只此一道拦不住执行图→PNG,见上 options.serialize)
        // 执行图闸第二挂点=官方 core 同款(uploadAudio.ts 对 audioUIWidget 即
        // 属性+options 双挂):不依赖 addDOMWidget 对入参 options 的透传细节
        w.options.serialize = false;
        el.addEventListener("change", () => post(el.value));
        el.addEventListener("blur", () => post(el.value));
    },
});
