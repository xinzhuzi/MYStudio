# 画布提效插件 AlignLayout(候选未装)

> 2026-10-18 调研入档。来源=B站视频 BV1gsJk6REzT《ComfyUI 连线更顺手了!AlignLayout v1.6.4 更新介绍》(UP 噼哩画啦,2026-10-15)+ GitHub 仓库实查(README/pyproject/tags)。
> 定位:ComfyUI 画布**人手接线/排版提效**插件(纯前端 JS 扩展,双实现适配默认前端与 Nodes 2.0)。仓库 https://github.com/pixixai/ComfyUI-AlignLayout
> 现状:**未装候选**(装否候用户裁定)。license 实查(2026-10-18,GitHub API+raw 双查)=**无 LICENSE 文件**(pyproject 引用 `{file = "LICENSE"}` 但 raw 404);台账口径 `verified_license=unknown`,严禁记开源许可。

## 一、功能与触发键全表(v1.6.4 视频口径 / GitHub main 现版 v1.6.5)

| 功能 | 触发 | 说明 |
|---|---|---|
| 节点对齐(对齐面板) | **Alt+A** | 辐射菜单:上/下/左/右对齐、横/纵居中、间距分布、居中自动排版;点击或鼠标甩动双模触发 |
| 节点拉伸(拉伸面板) | **Alt+S** | 统一节点尺寸(单边拉伸/最大匹配/复位);与对齐面板互斥 |
| 自动布局 | **Alt+L** | 一键智能布局、正/反向、防碰撞、可撤销 |
| 添加节点菜单 | **A** | 鼠标跟随级联菜单找/加节点,可拖拽钉住+收藏 |
| 收藏节点菜单 | **Q** | 快速取收藏件,与添加菜单共享数据 |
| 快速连接·汇聚(多对一) | **F** | 智能多连线,带轮询/保护线/阈值 |
| 快速连接·广播(一对多) | **Shift+F** | 同上,方向反 |
| 强制汇聚 / 强制广播 | **Ctrl+F** / **Ctrl+Shift+F** | 阈值不满足时强制执行 |
| 链式连接 | **Alt+F** | 链式逐件串连 |
| **连线清理** | **Ctrl+Shift+Alt+F** | 清选中组**内部**连线;**Shift+Alt+F**=清**外部**连线(保留组内互连) |
| **划线断开**(v1.6.4 新) | 按住 **Ctrl**(近距高亮)→ **Ctrl+右键拖划** | 划过即断线,无需先选节点;支持曲线/直线/折线/**子图**;整划可 Ctrl+Z 撤销 |
| **连接助手**(v1.6.4 新) | 从端口拖出后按一下 **Ctrl** | 连线锁定(松开左键连接挂起不丢);Ctrl 悬停节点 ~200ms 临时放大定位;点空白弹出兼容节点菜单(真目标就近落位);Esc/右键取消 |
| **兼容节点查找**(v1.6.4 新) | 连接助手内 | 按名字/序号过滤当前可连接的兼容节点 |
| **端口高亮**(v1.6.4 新) | 锁线后悬停目标 | 类型兼容端口全亮、目标端口增强高亮 |
| 选择相同节点 | **Shift+A** | 全选同类型节点(可多选多类型) |
| 替换节点 | **Shift+R** | 热替换+自动迁移连线/参数;智能端口匹配(名字优先/唯一类型/强制顺序);支持批量+撤销+自动搜索面板 |

v1.6.4 其余更新:对齐面板/节点替换/节点菜单/连线清理四项体验优化 + Nodes 2.0 全面适配(开关=前端设置 `Comfy.VueNodes.Enabled`)。

键位均可在设置自定义。单字母键(A/Q/F)与引擎家已装 ~50 插件(rgthree 等)的冲突面**装机后实测**,勿预断。

## 二、对本项目的吸收价值(2026-10-18 评估)

**吸收面=用户画布内手工编辑**(真场景在案:0929 用户手排重立、用户自改副本调试):
- 大图接线(道劫主图百件级):连接助手+兼容节点查找+端口高亮+连线锁定,缩幕远距接线不再眯眼找口;
- 扇出布线(加载器 CLIP/VAE 一对多):快速连接 广播/汇聚/链式,手接扇出从几十次拖拽降到几下;
- 断线清理:划线断开(支持子图)+连线清理,配 0926 线不遮/0928 线不交叉治理;
- 手排横平竖直:对齐面板/拉伸/自动布局;
- 换件探查:替换节点 Shift+R(**仅限用户自改副本/实验图**,铁则见§三②)。

**布局/美观/连线域已吸收为非手动形态(2026-10-18 二轮令,源码实读版)**:已通读上游仓库源码(`web/default/` 全域+设计文档+更新日志 1.0.6-1.6.5 全核)并把其算法落成 AI 侧纯函数进 node-graph 技能(`.agents/skills/node-graph/tools/layout_polish.py` v4,16 函数+优化集 OPTIMIZATION.md 布局策略 ⑩;六式对齐/等距与定隙堆叠/同宽居中/尺寸收敛/防碰撞落位/悬空线清扫/选区内外清线/换件端口四级阶梯/列序混合排序/连线创建三式(汇聚·广播·链式+评分梯+落线)+「美观双不增」守门;上游无 LICENSE 文件故零逐字拷贝、方法重实现;`画布布局规范.md` §五 1018 补立同口径)——AI 改图自带这套排版/连线智力,与插件本体装否无关。**插件本体的残余吸收面=纯交互层**(划线断开/连接助手/端口高亮/连线锁定的指针交互与菜单呈现,其算法层已尽数吸收)+用户手排时的对齐/拉伸/自动布局快捷键。

## 三、与生产布局规范的互动铁则(装了也必须守)

1. **生产三件(t2i/i2i/edit)坐标=布局基线账管辖**(`workflow_layout_baseline.json` 单源,audit/layout_check 口径)。用户手排(含 AlignLayout 辅助)结果回流仓库真源时,须过 layout_check 判据后按《画布布局规范.md》§三重立纪律立账(0929 先例:用户原始布局带 3 线遮+6 est 间距+1 负区违禁**不可采用**,合规态才立)。AlignLayout「自动布局」**不内建线不交叉判据**,产物勿直接当合规态。
2. **替换节点(Shift+R)=智能端口匹配,无工程契约感知**:对子图宿主件/边界契约(`inputs[].linkIds`、宿主面板 `widgets_values` 镜像、`proxyWidgets`)不保证保真——生产件替换恒走手术脚本(7027 拆共用 Fix 先例:保链 id 改 origin+边界口 linkIds+蓝图三件套同步);UI 级替换仅限用户自改副本。
3. **装配路径铁律**:落位=`<引擎家>/ComfyUI/custom_nodes/`(源码目录内;家根层 custom_nodes 不加载,manifest.py 09-08 fix);装后**重启引擎**才注册/生效;插件更新后须刷新前端页面。
4. **台账纪律**:装=`curated_plugins.json` 补行(license=unknown 如实录入);装卸走插件台账(`/comfy/plugins` 端点/插件卡),勿手删目录。

## 四、版本与兼容

- 视频口径 v1.6.4(2026-10-15);GitHub main 现版 **v1.6.5**(pyproject 实查 2026-10-18;tags 只到 v1.0.6,版本真源=pyproject)。迭代快,装机时以现版 README 为准。
- Nodes 2.0 双实现(`web/default/` 与 `web/nodes2/`,入口 `web/entry.js`);本机是否开 Nodes 2.0 未记录,两态均可用。
- README 测试基准=前端 1.53.10;本机引擎 v0.37.0(前端更新),兼容预期良好但**未实弹不立据**。
- rgthree-comfy(已装)与其部分重叠(排版辅助/菜单),AlignLayout 强项=连线族(快速连接/划线断开/连接助手)与替换;二者可共存,键位冲突面装机实测。

## 五、工程借鉴档(1018 v4 补查;源码级,我仓前端扩展域的前瞻粮草)

1. **scope 生命周期抽象**(`web/runtime.js`,~80 行)——**已吸收为真代码**:`my_nodes/web/my_scope.js`(方法重实现,四律=登记/逆序回收/失败隔离/全局占用恢复;listen/expose/timeout/add/dispose),探针=`my_nodes/tests/my_scope_probe_1018.mjs`(jsdom 15 断言全绿,1018);我仓 `my_nodes/web/*.js`(sidebar.js 族)现直挂监听/DOM 无统一 teardown——**新功能接线时用 my_scope,存量 retrofit 候真役驱动**。
2. **双前端模式热切换**(`entry.js`+`createModeController`)——**已吸收**:同件 `MyScope.createModeController`(switchMode 收旧建新/setup 中途死即返/抛错全收+态复位;探针三态全绿);监听 `Comfy.VueNodes.Enabled.change` 的接线留待我仓真迁 Nodes 2.0 时挂(现无消费端)。
3. **Nodes 2.0 API 差清单**(nodes2/auto_layout.js vs default 实 diff,仅 37 行但刀刀要害):组几何=`entity.renderingSize` 非 `size`;组内子件起点=`pos+titleHeight+10`(Nodes 2.0 的组 pos=含标题栏的外框,与默认模式语义不同);标题高恒量=`LiteGraph.NODE_TITLE_HEIGHT`;选组=`canvas.selectedItems`+递归 `group.children` 遍历(非默认模式的 `selected_group`)。→ 我仓画布 JS 迁移时的第一批 API 换血点。
4. **getCoalescedEvents 指针轨迹**(link_cut.js):`pointermove` 的 `event.getCoalescedEvents()` 逐个回放=快速划动零漏点——判定距 4px 之所以可靠的底座(浏览器 PointerEvent 合并事件 API);「自适应采样」的更新日志措辞实际指此。
5. **菜单数据原子写**(`nodes/_menu_data.py`):`Lock`+写临时文件+`os.replace` 原子换名+`finally unlink(missing_ok=True)`,读也过锁;旧五文件迁移核对成功后才删。→ 与我仓手术脚本 fail-closed 落盘同律,独立印证。
6. **renderLink 参数多态取证**(web/docs/LineEdit修改连线测试.md,RedBoldLinks 渲染实验非插件功能):第三方(CircuitBoardLines)调 `renderLink` 传**坐标数组**而非独立 x/y,颜色/线宽参数位随签名漂移(Index 8 vs 6),方向参数被覆盖=曲率异常;解法=按首参类型做参数多态检测。→ 将来若做连线着色(如桥线高亮)必防的坑。
