import type { ViewpointKeywordMap } from "./scene-viewpoint-extraction";

// ==================== 视角关键词映射 ====================

/**
 * 动作关键词 -> 视角映射
 * 从分镜动作描写中识别需要的视角
 * 扩展关键词以覆盖更多场景
 * 
 * 【重要】environments 字段控制该视角适用于哪些环境类型
 * - 空数组 [] 表示通用视角，适用于所有环境
 * - 指定环境类型列表表示仅在这些环境中匹配
 */
export const VIEWPOINT_KEYWORDS: ViewpointKeywordMap = {
  // ========== 古代室内视角 (ancient_indoor) ==========
  // 堂屋/正厅
  '堂屋': { id: 'ancient_hall', name: '堂屋', nameEn: 'Main Hall', propsZh: ['太师椅', '案几', '寿屏'], propsEn: ['taishi chair', 'table', 'screen'], environments: ['ancient_indoor'] },
  '正堂': { id: 'ancient_hall', name: '正堂', nameEn: 'Main Hall', propsZh: ['寿屏', '上座'], propsEn: ['screen', 'main seat'], environments: ['ancient_indoor'] },
  '大堂': { id: 'ancient_hall', name: '大堂', nameEn: 'Grand Hall', propsZh: ['案几', '纱帐'], propsEn: ['table', 'gauze curtain'], environments: ['ancient_indoor'] },
  '厅堂': { id: 'ancient_hall', name: '厅堂', nameEn: 'Reception Hall', propsZh: ['案几', '寛椅'], propsEn: ['table', 'armchair'], environments: ['ancient_indoor'] },
  // 案几/坐具
  '案几': { id: 'ancient_table', name: '案几', nameEn: 'Ancient Table', propsZh: ['案几', '茶具', '笔墨'], propsEn: ['table', 'tea set', 'brush and ink'], environments: ['ancient_indoor'] },
  '书案': { id: 'ancient_table', name: '书案', nameEn: 'Writing Desk', propsZh: ['书案', '笔墨纸砚'], propsEn: ['writing desk', 'brush, ink, paper, inkstone'], environments: ['ancient_indoor'] },
  '坐在案前': { id: 'ancient_table', name: '案几', nameEn: 'At the Table', propsZh: ['案几'], propsEn: ['table'], environments: ['ancient_indoor'] },
  '跑堂': { id: 'ancient_table', name: '酒楼大堂', nameEn: 'Tavern Hall', propsZh: ['方桌', '酒壶', '菜肴'], propsEn: ['square table', 'wine pot', 'dishes'], environments: ['ancient_indoor'] },
  // 屏风/蜗帐
  '屏风': { id: 'ancient_screen', name: '屏风', nameEn: 'Screen View', propsZh: ['屏风', '帐幔'], propsEn: ['screen', 'curtain'], environments: ['ancient_indoor'] },
  '纱帐': { id: 'ancient_screen', name: '纱帐', nameEn: 'Gauze Curtain', propsZh: ['纱帐', '垂帐'], propsEn: ['gauze curtain', 'hanging drape'], environments: ['ancient_indoor'] },
  '帐后': { id: 'ancient_screen', name: '帐后', nameEn: 'Behind the Curtain', propsZh: ['帐幔'], propsEn: ['curtain'], environments: ['ancient_indoor'] },
  // 闺房/内室
  '闺房': { id: 'ancient_boudoir', name: '闺房', nameEn: 'Boudoir', propsZh: ['妆台', '铜镜', '梳妆盒'], propsEn: ['dressing table', 'bronze mirror', 'makeup box'], environments: ['ancient_indoor'] },
  '梳妆': { id: 'ancient_boudoir', name: '妆台', nameEn: 'Dressing Table', propsZh: ['妆台', '铜镜'], propsEn: ['dressing table', 'bronze mirror'], environments: ['ancient_indoor'] },
  '绣楼': { id: 'ancient_boudoir', name: '绣楼', nameEn: 'Embroidery Chamber', propsZh: ['绣架', '绣线'], propsEn: ['embroidery frame', 'silk thread'], environments: ['ancient_indoor'] },
  // 榻/床
  '榻': { id: 'ancient_couch', name: '榻', nameEn: 'Ancient Couch', propsZh: ['榻', '软垫'], propsEn: ['daybed', 'cushion'], environments: ['ancient_indoor'] },
  '罗汉床': { id: 'ancient_couch', name: '罗汉床', nameEn: 'Arhat Bed', propsZh: ['罗汉床', '青瓷茶具'], propsEn: ['arhat bed', 'celadon tea set'], environments: ['ancient_indoor'] },
  '床榻': { id: 'ancient_couch', name: '床榻', nameEn: 'Bed', propsZh: ['床', '床帐'], propsEn: ['bed', 'bed curtain'], environments: ['ancient_indoor'] },
  '厂房': { id: 'ancient_couch', name: '卢室', nameEn: 'Bedroom', propsZh: ['床', '帐子'], propsEn: ['bed', 'canopy'], environments: ['ancient_indoor'] },
  // 书房古代
  '挥毫': { id: 'ancient_study', name: '书房', nameEn: 'Study', propsZh: ['笔墨纸砚', '书架'], propsEn: ['four treasures of study', 'bookshelf'], environments: ['ancient_indoor'] },
  '提笔': { id: 'ancient_study', name: '书房', nameEn: 'Study', propsZh: ['毛笔', '砕台'], propsEn: ['brush', 'inkstone'], environments: ['ancient_indoor'] },
  '读书': { id: 'ancient_study', name: '书房', nameEn: 'Study', propsZh: ['书卷', '烛灯'], propsEn: ['books', 'candle'], environments: ['ancient_indoor'] },
  // 佛堂/祁堂
  '佛堂': { id: 'ancient_shrine', name: '佛堂', nameEn: 'Buddha Hall', propsZh: ['佛像', '香炉', '蒲团'], propsEn: ['Buddha statue', 'incense burner', 'cushion'], environments: ['ancient_indoor'] },
  '上香': { id: 'ancient_shrine', name: '佛堂', nameEn: 'Offering Incense', propsZh: ['香炉', '香'], propsEn: ['incense burner', 'incense'], environments: ['ancient_indoor'] },
  '跨拜': { id: 'ancient_shrine', name: '祁堂', nameEn: 'Ancestral Hall', propsZh: ['牠位', '跨垫'], propsEn: ['memorial tablet', 'kneeling cushion'], environments: ['ancient_indoor'] },
  
  // ========== 古代户外视角 (ancient_outdoor) ==========
  // 庭院
  '庭院': { id: 'ancient_courtyard', name: '庭院', nameEn: 'Courtyard', propsZh: ['假山', '水池', '花丛'], propsEn: ['rockery', 'pond', 'flower bed'], environments: ['ancient_outdoor'] },
  '前院': { id: 'ancient_courtyard', name: '前院', nameEn: 'Front Yard', propsZh: ['石阶', '垂花'], propsEn: ['stone steps', 'hanging flowers'], environments: ['ancient_outdoor'] },
  '后院': { id: 'ancient_courtyard', name: '后院', nameEn: 'Back Yard', propsZh: ['花丛', '竹林'], propsEn: ['flower bed', 'bamboo grove'], environments: ['ancient_outdoor'] },
  // 池塘/亝子
  '池塘': { id: 'ancient_pond', name: '池塘', nameEn: 'Pond View', propsZh: ['荷塘', '木桥', '亝'], propsEn: ['lotus pond', 'wooden bridge', 'pavilion'], environments: ['ancient_outdoor'] },
  '荷塘': { id: 'ancient_pond', name: '荷塘', nameEn: 'Lotus Pond', propsZh: ['荷叶', '荷花', '莲蓬'], propsEn: ['lotus leaves', 'lotus flowers', 'lotus seedpod'], environments: ['ancient_outdoor'] },
  '亝子': { id: 'ancient_pavilion', name: '亝子', nameEn: 'Pavilion', propsZh: ['亝', '石凳', '栏杆'], propsEn: ['pavilion', 'stone bench', 'railing'], environments: ['ancient_outdoor'] },
  '流水': { id: 'ancient_pond', name: '水景', nameEn: 'Water View', propsZh: ['小桥', '流水'], propsEn: ['bridge', 'stream'], environments: ['ancient_outdoor'] },
  // 官道/街道
  '官道': { id: 'ancient_road', name: '官道', nameEn: 'Official Road', propsZh: ['官道', '松柏'], propsEn: ['road', 'pine trees'], environments: ['ancient_outdoor'] },
  '驿站': { id: 'ancient_road', name: '驿站', nameEn: 'Post Station', propsZh: ['驿站', '马棚'], propsEn: ['post station', 'stable'], environments: ['ancient_outdoor'] },
  '赶路': { id: 'ancient_road', name: '道路', nameEn: 'Road', propsZh: ['道路'], propsEn: ['road'], environments: ['ancient_outdoor'] },
  // 集市/城门
  '集市': { id: 'ancient_market', name: '集市', nameEn: 'Market', propsZh: ['市集', '摆', '人群'], propsEn: ['market', 'stalls', 'crowd'], environments: ['ancient_outdoor'] },
  '城门': { id: 'ancient_gate', name: '城门', nameEn: 'City Gate', propsZh: ['城门', '城墙', '士兵'], propsEn: ['city gate', 'city wall', 'soldiers'], environments: ['ancient_outdoor'] },
  '城楼': { id: 'ancient_gate', name: '城楼', nameEn: 'City Tower', propsZh: ['城楼', '城墙'], propsEn: ['city tower', 'city wall'], environments: ['ancient_outdoor'] },
  // 码头/渡口
  '码头': { id: 'ancient_dock', name: '码头', nameEn: 'Dock', propsZh: ['木栅', '船只', '缆绳'], propsEn: ['wooden pier', 'boats', 'mooring rope'], environments: ['ancient_outdoor'] },
  '渡口': { id: 'ancient_dock', name: '渡口', nameEn: 'Ferry Crossing', propsZh: ['渡船', '河水'], propsEn: ['ferry boat', 'river'], environments: ['ancient_outdoor'] },
  
  // ========== 古代交通视角 (ancient_vehicle) ==========
  // 马车/轿子
  '轿子': { id: 'ancient_sedan', name: '轿内', nameEn: 'Sedan Chair', propsZh: ['轿帘', '轿内'], propsEn: ['sedan curtain', 'sedan interior'], environments: ['ancient_vehicle'] },
  '轿内': { id: 'ancient_sedan', name: '轿内', nameEn: 'Inside Sedan', propsZh: ['轿帘', '坐垫'], propsEn: ['sedan curtain', 'cushion'], environments: ['ancient_vehicle'] },
  '上轿': { id: 'ancient_sedan', name: '轿门', nameEn: 'Entering Sedan', propsZh: ['轿门', '轿帘'], propsEn: ['sedan door', 'curtain'], environments: ['ancient_vehicle'] },
  '下轿': { id: 'ancient_sedan', name: '轿门', nameEn: 'Exiting Sedan', propsZh: ['轿门'], propsEn: ['sedan door'], environments: ['ancient_vehicle'] },
  '马车': { id: 'ancient_carriage', name: '车内', nameEn: 'Carriage', propsZh: ['车篾', '坐垫'], propsEn: ['carriage canopy', 'cushion'], environments: ['ancient_vehicle'] },
  '车内': { id: 'ancient_carriage', name: '车内', nameEn: 'Inside Carriage', propsZh: ['车篾', '窗帘'], propsEn: ['canopy', 'window curtain'], environments: ['ancient_vehicle'] },
  // 船只
  '船舱': { id: 'ancient_boat', name: '船舱', nameEn: 'Boat Cabin', propsZh: ['船舱', '窗子'], propsEn: ['cabin', 'window'], environments: ['ancient_vehicle'] },
  '舱内': { id: 'ancient_boat', name: '船舱', nameEn: 'Inside Cabin', propsZh: ['船舱', '窗子', '木方'], propsEn: ['cabin', 'window', 'wooden table'], environments: ['ancient_vehicle'] },
  '甲板': { id: 'ancient_deck', name: '甲板', nameEn: 'Ship Deck', propsZh: ['甲板', '桶杆', '风帆'], propsEn: ['deck', 'mast', 'sail'], environments: ['ancient_vehicle'] },
  '船头': { id: 'ancient_deck', name: '船头', nameEn: 'Bow', propsZh: ['船头', '桶杆'], propsEn: ['bow', 'mast'], environments: ['ancient_vehicle'] },
  '船尾': { id: 'ancient_deck', name: '船尾', nameEn: 'Stern', propsZh: ['船尾', '艰'], propsEn: ['stern', 'rudder'], environments: ['ancient_vehicle'] },
  // 骑马
  '骑马': { id: 'ancient_horse', name: '马背', nameEn: 'On Horseback', propsZh: ['马', '缰绳', '马鞍'], propsEn: ['horse', 'reins', 'saddle'], environments: ['ancient_vehicle'] },
  '上马': { id: 'ancient_horse', name: '马背', nameEn: 'Mounting', propsZh: ['马蹬', '马鞍'], propsEn: ['stirrup', 'saddle'], environments: ['ancient_vehicle'] },
  '下马': { id: 'ancient_horse', name: '马背', nameEn: 'Dismounting', propsZh: ['马'], propsEn: ['horse'], environments: ['ancient_vehicle'] },
  '驰骋': { id: 'ancient_horse', name: '马背', nameEn: 'Galloping', propsZh: ['马', '缰绳'], propsEn: ['horse', 'reins'], environments: ['ancient_vehicle'] },
  
  // ========== 现代交通工具视角 (vehicle) ==========
  // 车窗视角
  '车窗': { id: 'vehicle_window', name: '车窗', nameEn: 'Vehicle Window View', propsZh: ['车窗', '窗外风景'], propsEn: ['vehicle window', 'outside scenery'], environments: ['vehicle'] },
  '窗外风景': { id: 'vehicle_window', name: '车窗', nameEn: 'Vehicle Window View', propsZh: ['车窗', '风景'], propsEn: ['vehicle window', 'scenery'], environments: ['vehicle'] },
  // 车内座位视角
  '座位': { id: 'vehicle_seat', name: '座位区', nameEn: 'Seat Area', propsZh: ['座位', '扁手'], propsEn: ['seat', 'armrest'], environments: ['vehicle'] },
  '车座': { id: 'vehicle_seat', name: '座位区', nameEn: 'Seat Area', propsZh: ['车座'], propsEn: ['vehicle seat'], environments: ['vehicle'] },
  '坐在': { id: 'vehicle_seat', name: '座位区', nameEn: 'Seat Area', propsZh: ['座位'], propsEn: ['seat'], environments: ['vehicle'] },
  // 车内过道视角
  '过道': { id: 'vehicle_aisle', name: '过道', nameEn: 'Aisle View', propsZh: ['过道', '扶手'], propsEn: ['aisle', 'handrail'], environments: ['vehicle'] },
  '走道': { id: 'vehicle_aisle', name: '过道', nameEn: 'Aisle View', propsZh: ['过道'], propsEn: ['aisle'], environments: ['vehicle'] },
  // 驾驶位视角
  '驾驶': { id: 'vehicle_driver', name: '驾驶位', nameEn: 'Driver Area', propsZh: ['方向盘', '仪表盘'], propsEn: ['steering wheel', 'dashboard'], environments: ['vehicle'] },
  '司机': { id: 'vehicle_driver', name: '驾驶位', nameEn: 'Driver Area', propsZh: ['方向盘'], propsEn: ['steering wheel'], environments: ['vehicle'] },
  '开车': { id: 'vehicle_driver', name: '驾驶位', nameEn: 'Driver Area', propsZh: ['方向盘', '仪表盘'], propsEn: ['steering wheel', 'dashboard'], environments: ['vehicle'] },
  // 车门视角
  '车门': { id: 'vehicle_door', name: '车门', nameEn: 'Vehicle Door', propsZh: ['车门', '台阶'], propsEn: ['vehicle door', 'steps'], environments: ['vehicle'] },
  '上车': { id: 'vehicle_door', name: '车门', nameEn: 'Vehicle Door', propsZh: ['车门', '台阶'], propsEn: ['vehicle door', 'steps'], environments: ['vehicle'] },
  '下车': { id: 'vehicle_door', name: '车门', nameEn: 'Vehicle Door', propsZh: ['车门', '台阶'], propsEn: ['vehicle door', 'steps'], environments: ['vehicle'] },
  
  // ========== 户外视角 (outdoor) ==========
  // 道路视角
  '路边': { id: 'roadside', name: '路边', nameEn: 'Roadside View', propsZh: ['道路', '路牙'], propsEn: ['road', 'curb'], environments: ['outdoor'] },
  '马路': { id: 'roadside', name: '道路', nameEn: 'Road View', propsZh: ['道路', '树木'], propsEn: ['road', 'trees'], environments: ['outdoor'] },
  '街道': { id: 'street', name: '街景', nameEn: 'Street View', propsZh: ['街道', '路灯', '店铺'], propsEn: ['street', 'streetlight', 'shops'], environments: ['outdoor'] },
  '街头': { id: 'street', name: '街景', nameEn: 'Street View', propsZh: ['街道', '行人'], propsEn: ['street', 'pedestrians'], environments: ['outdoor'] },
  // 自然风景视角
  '田野': { id: 'nature', name: '自然风景', nameEn: 'Nature View', propsZh: ['田野', '庄稼'], propsEn: ['field', 'crops'], environments: ['outdoor'] },
  '山': { id: 'nature', name: '自然风景', nameEn: 'Nature View', propsZh: ['山峦'], propsEn: ['mountains'], environments: ['outdoor'] },
  '河': { id: 'nature', name: '自然风景', nameEn: 'Nature View', propsZh: ['河流'], propsEn: ['river'], environments: ['outdoor'] },
  '树': { id: 'nature', name: '自然风景', nameEn: 'Nature View', propsZh: ['树木', '树叶'], propsEn: ['trees', 'leaves'], environments: ['outdoor'] },
  // 庭院视角
  '院子': { id: 'yard', name: '庭院', nameEn: 'Yard View', propsZh: ['院子', '围墙'], propsEn: ['yard', 'wall'], environments: ['outdoor'] },
  '花园': { id: 'garden', name: '花园', nameEn: 'Garden View', propsZh: ['花卉', '植物'], propsEn: ['flowers', 'plants'], environments: ['outdoor'] },
  
  // ========== 室内家居视角 (indoor_home) ==========
  // 餐桌/用餐相关
  '吃饭': { id: 'dining', name: '餐桌区', nameEn: 'Dining Area', propsZh: ['餐桌', '碗筷', '菜肴'], propsEn: ['dining table', 'bowls and chopsticks', 'dishes'], environments: ['indoor_home', 'indoor_public'] },
  '饭桌': { id: 'dining', name: '餐桌区', nameEn: 'Dining Area', propsZh: ['餐桌', '碗筷', '菜肴'], propsEn: ['dining table', 'bowls and chopsticks', 'dishes'], environments: ['indoor_home', 'indoor_public'] },
  '餐桌': { id: 'dining', name: '餐桌区', nameEn: 'Dining Area', propsZh: ['餐桌', '碗筷'], propsEn: ['dining table', 'bowls and chopsticks'], environments: ['indoor_home', 'indoor_public'] },
  '用餐': { id: 'dining', name: '餐桌区', nameEn: 'Dining Area', propsZh: ['餐桌', '碗筷', '菜肴'], propsEn: ['dining table', 'bowls and chopsticks', 'dishes'], environments: ['indoor_home', 'indoor_public'] },
  '端菜': { id: 'dining', name: '餐桌区', nameEn: 'Dining Area', propsZh: ['餐桌', '菜肴'], propsEn: ['dining table', 'dishes'], environments: ['indoor_home', 'indoor_public'] },
  '夹菜': { id: 'dining', name: '餐桌区', nameEn: 'Dining Area', propsZh: ['餐桌', '碗筷'], propsEn: ['dining table', 'chopsticks'], environments: ['indoor_home', 'indoor_public'] },
  '喝酒': { id: 'dining', name: '餐桌区', nameEn: 'Dining Area', propsZh: ['餐桌', '酒杯'], propsEn: ['dining table', 'wine glass'], environments: ['indoor_home', 'indoor_public'] },
  '碰杯': { id: 'dining', name: '餐桌区', nameEn: 'Dining Area', propsZh: ['餐桌', '酒杯'], propsEn: ['dining table', 'glasses'], environments: ['indoor_home', 'indoor_public'] },
  '举杯': { id: 'dining', name: '餐桌区', nameEn: 'Dining Area', propsZh: ['餐桌', '酒杯'], propsEn: ['dining table', 'glasses'], environments: ['indoor_home', 'indoor_public'] },
  
  // 沙发/客厅相关 - 仅室内家居
  '沙发': { id: 'sofa', name: '沙发区', nameEn: 'Sofa Area', propsZh: ['沙发', '茶几', '电视'], propsEn: ['sofa', 'coffee table', 'TV'], environments: ['indoor_home'] },
  '看电视': { id: 'sofa', name: '沙发区', nameEn: 'Sofa Area', propsZh: ['沙发', '电视'], propsEn: ['sofa', 'television'], environments: ['indoor_home'] },
  '茶几': { id: 'sofa', name: '沙发区', nameEn: 'Sofa Area', propsZh: ['沙发', '茶几'], propsEn: ['sofa', 'coffee table'], environments: ['indoor_home'] },
  '倒茶': { id: 'sofa', name: '沙发区', nameEn: 'Sofa Area', propsZh: ['沙发', '茶几', '茶壶'], propsEn: ['sofa', 'coffee table', 'teapot'], environments: ['indoor_home', 'indoor_work'] },
  '喝茶': { id: 'sofa', name: '沙发区', nameEn: 'Sofa Area', propsZh: ['沙发', '茶几', '茶杯'], propsEn: ['sofa', 'coffee table', 'teacup'], environments: ['indoor_home', 'indoor_work'] },
  
  // 窗边相关 - 室内用
  '窗': { id: 'window', name: '窗边', nameEn: 'Window View', propsZh: ['窗户', '窗帘'], propsEn: ['window', 'curtains'], environments: ['indoor_home', 'indoor_work', 'indoor_public'] },
  '窗外': { id: 'window', name: '窗边', nameEn: 'Window View', propsZh: ['窗户', '窗帘', '自然光'], propsEn: ['window', 'curtains', 'natural light'], environments: ['indoor_home', 'indoor_work', 'indoor_public'] },
  '窗边': { id: 'window', name: '窗边', nameEn: 'Window View', propsZh: ['窗户', '窗帘'], propsEn: ['window', 'curtains'], environments: ['indoor_home', 'indoor_work', 'indoor_public'] },
  '阳台': { id: 'window', name: '窗边/阳台', nameEn: 'Balcony View', propsZh: ['阳台', '栏杆'], propsEn: ['balcony', 'railing'], environments: ['indoor_home'] },
  '窗帘': { id: 'window', name: '窗边', nameEn: 'Window View', propsZh: ['窗户', '窗帘'], propsEn: ['window', 'curtains'], environments: ['indoor_home', 'indoor_work'] },
  
  // 入口/门相关 - 室内用
  '门口': { id: 'entrance', name: '入口', nameEn: 'Entrance View', propsZh: ['门', '玄关'], propsEn: ['door', 'entrance'], environments: ['indoor_home', 'indoor_work', 'indoor_public'] },
  '门': { id: 'entrance', name: '入口', nameEn: 'Entrance View', propsZh: ['门', '玄关'], propsEn: ['door', 'entrance'], environments: ['indoor_home', 'indoor_work', 'indoor_public'] },
  '进门': { id: 'entrance', name: '入口', nameEn: 'Entrance View', propsZh: ['门', '玄关'], propsEn: ['door', 'entrance'], environments: ['indoor_home', 'indoor_work', 'indoor_public'] },
  '出门': { id: 'entrance', name: '入口', nameEn: 'Entrance View', propsZh: ['门'], propsEn: ['door'], environments: ['indoor_home', 'indoor_work', 'indoor_public'] },
  '回家': { id: 'entrance', name: '入口', nameEn: 'Entrance View', propsZh: ['门', '玄关'], propsEn: ['door', 'entrance'], environments: ['indoor_home'] },
  '进来': { id: 'entrance', name: '入口', nameEn: 'Entrance View', propsZh: ['门'], propsEn: ['door'], environments: ['indoor_home', 'indoor_work', 'indoor_public'] },
  '走进': { id: 'entrance', name: '入口', nameEn: 'Entrance View', propsZh: ['门'], propsEn: ['door'], environments: ['indoor_home', 'indoor_work', 'indoor_public'] },
  '离开': { id: 'entrance', name: '入口', nameEn: 'Entrance View', propsZh: ['门'], propsEn: ['door'], environments: ['indoor_home', 'indoor_work', 'indoor_public'] },
  '玄关': { id: 'entrance', name: '入口', nameEn: 'Entrance View', propsZh: ['门', '玄关', '鞋柜'], propsEn: ['door', 'entrance', 'shoe cabinet'], environments: ['indoor_home'] },
  '换鞋': { id: 'entrance', name: '入口', nameEn: 'Entrance View', propsZh: ['玄关', '鞋柜'], propsEn: ['entrance', 'shoe cabinet'], environments: ['indoor_home'] },
  
  // 厨房相关 - 仅室内家居
  '厨房': { id: 'kitchen', name: '厨房', nameEn: 'Kitchen', propsZh: ['灶台', '橱柜'], propsEn: ['stove', 'cabinets'], environments: ['indoor_home'] },
  '做饭': { id: 'kitchen', name: '厨房', nameEn: 'Kitchen', propsZh: ['灶台', '锅具'], propsEn: ['stove', 'cookware'], environments: ['indoor_home'] },
  '烧菜': { id: 'kitchen', name: '厨房', nameEn: 'Kitchen', propsZh: ['灶台', '锅具'], propsEn: ['stove', 'cookware'], environments: ['indoor_home'] },
  '炒菜': { id: 'kitchen', name: '厨房', nameEn: 'Kitchen', propsZh: ['灶台', '锅具'], propsEn: ['stove', 'wok'], environments: ['indoor_home'] },
  '洗碗': { id: 'kitchen', name: '厨房', nameEn: 'Kitchen', propsZh: ['水槽', '碗碟'], propsEn: ['sink', 'dishes'], environments: ['indoor_home'] },
  '切菜': { id: 'kitchen', name: '厨房', nameEn: 'Kitchen', propsZh: ['砧板', '菜刀'], propsEn: ['cutting board', 'knife'], environments: ['indoor_home'] },
  '冰箱': { id: 'kitchen', name: '厨房', nameEn: 'Kitchen', propsZh: ['冰箱'], propsEn: ['refrigerator'], environments: ['indoor_home'] },
  
  // 书房/工作相关 - 室内家居+办公
  '书桌': { id: 'study', name: '书房/书桌', nameEn: 'Study Area', propsZh: ['书桌', '台灯', '书架'], propsEn: ['desk', 'lamp', 'bookshelf'], environments: ['indoor_home', 'indoor_work'] },
  '电脑': { id: 'study', name: '书房/书桌', nameEn: 'Study Area', propsZh: ['书桌', '电脑'], propsEn: ['desk', 'computer'], environments: ['indoor_home', 'indoor_work'] },
  '看书': { id: 'study', name: '书房/书桌', nameEn: 'Study Area', propsZh: ['书桌', '台灯'], propsEn: ['desk', 'lamp'], environments: ['indoor_home', 'indoor_public'] },
  '写字': { id: 'study', name: '书房/书桌', nameEn: 'Study Area', propsZh: ['书桌', '台灯'], propsEn: ['desk', 'lamp'], environments: ['indoor_home', 'indoor_work'] },
  '办公': { id: 'study', name: '书房/书桌', nameEn: 'Study Area', propsZh: ['书桌', '电脑'], propsEn: ['desk', 'computer'], environments: ['indoor_work'] },
  '文件': { id: 'study', name: '书房/书桌', nameEn: 'Study Area', propsZh: ['书桌', '文件'], propsEn: ['desk', 'documents'], environments: ['indoor_home', 'indoor_work'] },
  '书架': { id: 'study', name: '书房/书桌', nameEn: 'Study Area', propsZh: ['书架', '书籍'], propsEn: ['bookshelf', 'books'], environments: ['indoor_home', 'indoor_work', 'indoor_public'] },
  
  // 卧室相关 - 必须明确提到床或卧室
  '卧室': { id: 'bedroom', name: '卧室', nameEn: 'Bedroom', propsZh: ['床', '床头柜'], propsEn: ['bed', 'nightstand'], environments: ['indoor_home'] },
  '床上': { id: 'bedroom', name: '卧室', nameEn: 'Bedroom', propsZh: ['床'], propsEn: ['bed'], environments: ['indoor_home'] },
  '起床': { id: 'bedroom', name: '卧室', nameEn: 'Bedroom', propsZh: ['床', '床头柜'], propsEn: ['bed', 'nightstand'], environments: ['indoor_home'] },
  '床头': { id: 'bedroom', name: '卧室', nameEn: 'Bedroom', propsZh: ['床', '床头柜', '台灯'], propsEn: ['bed', 'nightstand', 'lamp'], environments: ['indoor_home'] },
  '被窝': { id: 'bedroom', name: '卧室', nameEn: 'Bedroom', propsZh: ['床', '被子'], propsEn: ['bed', 'blanket'], environments: ['indoor_home'] },
  
  // ========== 通用视角（适用于所有环境） ==========
  // 对话/情感场景 - 通用
  '交谈': { id: 'conversation', name: '对话区', nameEn: 'Conversation Area', propsZh: [], propsEn: [], environments: [] },
  '聊天': { id: 'conversation', name: '对话区', nameEn: 'Conversation Area', propsZh: [], propsEn: [], environments: [] },
  '说话': { id: 'conversation', name: '对话区', nameEn: 'Conversation Area', propsZh: [], propsEn: [], environments: [] },
  '争吵': { id: 'conversation', name: '对话区', nameEn: 'Conversation Area', propsZh: [], propsEn: [], environments: [] },
  '吵架': { id: 'conversation', name: '对话区', nameEn: 'Conversation Area', propsZh: [], propsEn: [], environments: [] },
  '哭泣': { id: 'emotion', name: '情感特写', nameEn: 'Emotional Close-up', propsZh: [], propsEn: [], environments: [] },
  '流泪': { id: 'emotion', name: '情感特写', nameEn: 'Emotional Close-up', propsZh: [], propsEn: [], environments: [] },
  '微笑': { id: 'emotion', name: '情感特写', nameEn: 'Emotional Close-up', propsZh: [], propsEn: [], environments: [] },
  '拥抱': { id: 'emotion', name: '情感特写', nameEn: 'Emotional Close-up', propsZh: [], propsEn: [], environments: [] },
  
  // 特写镜头 - 通用
  '手': { id: 'detail', name: '细节特写', nameEn: 'Detail Close-up', propsZh: [], propsEn: [], environments: [] },
  '握着': { id: 'detail', name: '细节特写', nameEn: 'Detail Close-up', propsZh: [], propsEn: [], environments: [] },
  '拿起': { id: 'detail', name: '细节特写', nameEn: 'Detail Close-up', propsZh: [], propsEn: [], environments: [] },
  '放下': { id: 'detail', name: '细节特写', nameEn: 'Detail Close-up', propsZh: [], propsEn: [], environments: [] },
  '特写': { id: 'detail', name: '细节特写', nameEn: 'Detail Close-up', propsZh: [], propsEn: [], environments: [] },
  '近景': { id: 'detail', name: '细节特写', nameEn: 'Detail Close-up', propsZh: [], propsEn: [], environments: [] },
  
  // 观看/类泛用动作 - 通用
  '望向': { id: 'looking', name: '观看视角', nameEn: 'Looking View', propsZh: [], propsEn: [], environments: [] },
  '眰望': { id: 'looking', name: '观看视角', nameEn: 'Looking View', propsZh: [], propsEn: [], environments: [] },
  '注视': { id: 'looking', name: '观看视角', nameEn: 'Looking View', propsZh: [], propsEn: [], environments: [] },
  
  // 坐下/起身 - 根据环境动态适应
  '坐下': { id: 'seating', name: '坐席区', nameEn: 'Seating Area', propsZh: [], propsEn: [], environments: [] },
  '落座': { id: 'seating', name: '坐席区', nameEn: 'Seating Area', propsZh: [], propsEn: [], environments: [] },
  '起身': { id: 'seating', name: '坐席区', nameEn: 'Seating Area', propsZh: [], propsEn: [], environments: [] },
};

