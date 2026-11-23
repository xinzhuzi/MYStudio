"""Task evidence only: PRIMARY editorial table; no model, service or project writes."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/10-25-daojie-director-rule-conflict-validation'
BASE = TASK / 'research/chapter001-repair-1026'
OUT = BASE / 'storyboard-v2'
OUT.mkdir(exist_ok=True)
SNAP = BASE / 'snapshot-20261026T161314424840Z'
source = json.loads((SNAP / 'input.json').read_text())
snapshot = json.loads((SNAP / 'snapshot.json').read_text())
project = Path(snapshot['projectRoot'])
catalogue = {}
catalogue_files = []
for filename, key in [('characters.json', 'characters'), ('scenes.json', 'scenes'), ('props.json', 'items')]:
    p = project / 'store' / filename
    catalogue_files.append(p)
    for item in json.loads(p.read_text())['state'][key]:
        catalogue.setdefault(item['name'], []).append(item['id'])
# Source-exact verified aliases, not fuzzy matches.
aliases = {'铁山': '断臂散修', '角落少年': '晏燎'}
viewpoints = {v['sceneViewpointId'] for v in snapshot['envelope']['state']['continuityAssetVersions'] if v['assetKind'] == 'scene'}
rows = []
def c(name, pos, facing, start, end):
    return dict(name=name, position=pos, orientation=facing, actionIn=start, actionOut=end)
def p(name, pos, state):
    return dict(name=name, position=pos, state=state)
def add(scene_no, scene, seconds, description, size, camera, action, orientation, space, emotion, dialogue, sound, view, chars, props, start, end):
    assert view in viewpoints
    names = list(dict.fromkeys([scene] + [v['name'] for v in chars + props]))
    ids = []
    for name in names:
        found = catalogue.get(aliases.get(name, name), [])
        if len(found) == 1:
            ids.append(found[0])
    semantics = dict(sceneViewpointId=view, personFree=not chars, visibleCharacters=chars, visibleProps=props, actionIn=start, actionOut=end)
    rows.append(dict(sceneNo=scene_no, fields=[len(rows)+1, description, scene, names, seconds, size, camera, action, orientation, space, emotion, dialogue, sound, ids, semantics]))

add(1,'金水河码头',9,
'灰雾下几十盏风灯的豆大蓝白灯焰映出扛筐矿奴；赵四在最高木台踩断锚。第三排两块矿石滚到湿石板，挨鞭矿奴跪下又扛起筐，背痕渗淡红雾，旁人不停步。',
'全景','设计：缓摇','赵四呵斥后抽背；矿奴踉跄、跪倒、重扛；周围队伍继续搬。','矿奴侧背；赵四侧面','木台高位中后景；第三排矿奴中景；湿石板前景','压抑',
'赵四：手脚麻利些。','铁链叮响、竹筹拨动、鞭抽背闷响与矿奴闷哼。','dock-main-axis',
[c('赵四','中后景最高木台','侧面','脚踩断锚呵斥','鞭抽第三排矿奴'),c('矿奴','中景第三排','侧背','踉跄掉出两块矿石','跪倒后重新扛筐'),c('周围矿奴','两侧中远景','侧背','扛筐搬矿','不停步继续搬矿')],
[p('青盐鞭','赵四手中','抽背'),p('风灯','码头灯下','蓝白豆大灯焰'),p('铁链','矿奴脚踝至筐绳','随步拖动'),p('竹筹','监工手边','随链响拨动'),p('藤筐','矿奴肩上','装矿'),p('灵矿石','湿石板前景','两块滚落'),p('断锚','最高木台上','赵四脚下')],
'矿奴扛筐经过高台','挨鞭者重新扛筐，周围队伍未停')
add(1,'金水河码头',8,
'灰衫独孤沿小路经过，背囊扎口紧、破草鞋左绳断；苦力的巨型藤筐斜着，落石在独孤脚边砸空。',
'中景','设计：静止','独孤碰扎绳又缩手、咽下血腥味；苦力先骂再撞肩；独孤侧让半步、鞋后滑半寸避石；苦力回头啐唾沫后走远。','两人侧面','独孤右中景；苦力左中景；落石下前景','克制',
'苦力：滚开，瞎了眼么。<br>苦力：算你命大','码头铁链与竹筹声延续。','dock-main-axis',
[c('独孤剑尘','右中景','侧面','手触背囊扎绳后缩回','侧让半步、鞋后滑半寸，石块砸空'),c('苦力','左中景','侧面','先骂再撞过独孤肩膀','回头啐唾沫、说完走远')],
[p('旧布背囊','独孤背上','扎口紧'),p('藤筐','苦力肩上','倾斜掉石'),p('灵矿石','独孤脚边','砸空')],
'独孤手触扎绳又缩回，苦力尚未撞肩','苦力走远，独孤避开落石')
add(1,'金水河码头',8,
'藤筐后的小杂役弯腰捡矿渣，指腹被毒刺扎破，肩头一抖；赵四扬起青盐鞭。独孤从旁经过。',
'中景','设计：静止','小杂役抠住矿渣求饶；赵四喝骂扬鞭；独孤继续经过。','小杂役俯身侧面；赵四侧面；独孤侧背','小杂役下中景；赵四上后景；独孤右中景','紧张',
'赵四：偷懒的狗骨头！<br>小杂役：监工老爷开恩，小人捡完这个就搬……','铁链与竹筹声继续。','dock-main-axis',
[c('小杂役','下中景','俯身侧面','弯腰捡矿渣，被刺扎破指腹','抠住矿渣求饶'),c('赵四','上后景','侧面','厉声喝骂','鞭梢扬起'),c('独孤剑尘','右中景','侧背','沿小路经过','与小杂役错身')],
[p('青盐鞭','赵四手中','鞭梢扬起，水珠甩成细线'),p('矿渣','小杂役手中','锋利带毒刺'),p('旧布背囊','独孤背上','扎口紧')],
'小杂役弯腰捡矿渣','赵四扬鞭，小杂役求饶')
add(1,'金水河码头',10,
'半截朽木从栈道缝翻出，卡在赵四落脚处；落偏的鞭抽中空筐，藤条碎屑飞开。小杂役抱矿渣缩进船影，独孤仍往前走。',
'中景','设计：静止','独孤错身时鞋尖轻拨一次朽木；赵四落鞭失准；小杂役趁乱藏入船影；独孤脚步不慢，咽一口。','独孤侧背；赵四侧面；小杂役背向船影','朽木下前景；空筐中景；船影后景','隐忍',
'无台词','鞭抽空筐啪声；码头铁链声继续。','dock-main-axis',
[c('独孤剑尘','右中景','侧背','错身鞋尖轻拨朽木','仍向前走，咽一口'),c('赵四','左中景','侧面','鞭落向小杂役','鞭失准抽中空筐'),c('小杂役','中景至船影','背向船影','抠住矿渣','抱矿渣缩进船影')],
[p('半截朽木','赵四落脚处','从栈道缝翻出卡住落脚处'),p('青盐鞭','空筐上方','失准抽空筐'),p('空筐','中景','藤条炸开碎屑'),p('矿渣','小杂役怀中','抱走'),p('旧布背囊','独孤背上','扎口紧')],
'赵四鞭已扬，小杂役抱矿渣','小杂役缩进船影，独孤继续前行')
add(2,'道口镇当铺街',10,
'晨间铺面门板已陆续卸下，面摊已架锅；独孤摸空扁荷包。当铺高柜前，断左臂的铁山白布透发黑血浆，半株凝血草摆在柜前。',
'中景','设计：静止','独孤摸荷包后经过；铁山拍柜台控诉。','独孤侧背；铁山侧面朝高柜','独孤前景穿过；铁山中景在高柜下','贫困、愤怒',
'铁山：上面还沾着我兄弟的血。','仅对白。','street-main-axis',
[c('独孤剑尘','前景','侧背','摸空扁荷包','继续经过街道'),c('铁山','中景柜前','侧面朝高柜','断左臂白布透黑血浆','拍柜台控诉')],
[p('旧布背囊','独孤背上','扎口紧'),p('荷包','独孤手边','空扁'),p('凝血草','高柜前','半株')],
'独孤摸空荷包，铁山立在柜前','铁山拍柜控诉，独孤继续经过')
add(2,'道口镇当铺街',10,
'高柜后只露钱掌柜的一双眼。柜下铁山赤红着眼，断臂白布仍透黑血浆；柜台隔开两人。',
'中近景','设计：静止','钱掌柜拨算盘冷言压价；铁山声音发颤说起兄弟尸毒。','钱掌柜正面局部；铁山侧面','钱掌柜眼睛上中格；铁山下前景','冷漠、无助',
'钱掌柜：半钱碎银，爱当不当。不当滚。<br>铁山：我兄弟中了尸毒','算盘脆响。','street-main-axis',
[c('钱掌柜','上中格柜后','正面局部，仅眼睛','柜后拨算盘','冷言压价'),c('铁山','下前景柜前','侧面','赤红着眼','声音发颤说起兄弟尸毒')],
[],
'柜台后露出钱掌柜眼睛','铁山在柜下说起兄弟尸毒')
add(2,'道口镇当铺街',10,
'铁山独臂抵在高柜前，脸皮抽搐；高柜窗口只露钱掌柜冷漠的眼。半株凝血草留在柜前视野里。',
'中近景','设计：静止','钱掌柜说死活不管；铁山独臂颤抖砸柜，瞪窗口半息，低头说当。','铁山侧面；钱掌柜正面局部','铁山下中格；钱掌柜眼睛上后景','绝望',
'钱掌柜：死活不归我管。<br>铁山：……当。','仅对白。','street-main-axis',
[c('铁山','下中格柜前','侧面','脸皮抽搐、独臂发颤','砸柜、瞪半息后低头'),c('钱掌柜','上后景柜后','正面局部，仅眼睛','柜后冷笑','仍在高柜后')],
[p('凝血草','高柜前','半株')],
'钱掌柜说死活不归我管','铁山低头说当')
add(2,'道口镇当铺街',10,
'铁山攥着发黑碎银踉跄向暗巷，独孤从争执中间穿过，低头看自己虎口厚茧的手。',
'中景','设计：缓跟独孤','铁山抓银后隐入暗巷；独孤步伐不停，低头看手。','铁山背面；独孤侧面','铁山左后景暗巷；独孤右中景','克制、自照',
'无台词','无新增现场音效；设计：极低非现场洞箫。','street-main-axis',
[c('铁山','左中景至暗巷','背面','抓起发黑碎银','踉跄隐入暗巷'),c('独孤剑尘','右中景','侧面','穿过争执之间','不停步，低头看手')],
[p('碎银','铁山手中','发黑'),p('旧布背囊','独孤背上','扎口紧')],
'铁山抓起碎银','铁山隐入暗巷，独孤看手前行')
add(3,'客栈后院柴房',15,
'断墙框住抱囊蹲坐的独孤，巷口窄缝中是午后脚步齐整的十几个矿奴。妇人只在画外。天黑透后的起身以时间省略承接。',
'中景','设计：固定机位，以剪辑省略从午后到天黑的等待','独孤抱囊背抵断墙蹲着；巷口矿奴拖镣经过；妇人画外话毕走远；天黑透后独孤起身赴塾。','独孤侧面；矿奴侧背','独孤下中格墙根；矿奴只在后景巷口窄缝','等待、寒意',
'妇人乙：第二天胳膊上就多个圈，第三天拉上矿了，再没回来过。','脚镣拖石板、妇人碎脚步走远；原文镇子从早吵到晚的声场。','street-main-axis',
[c('独孤剑尘','下中格墙根','侧面','抱背囊，背抵断墙蹲着','天黑透后起身赴塾'),c('矿奴队伍','后景巷口窄缝','侧背','十几人脚步齐整','拖镣经过巷口')],
[p('旧布背囊','独孤膝上','抱着'),p('脚镣','巷口矿奴脚踝','拖石板')],
'午后独孤蹲着，巷口矿奴经过','时间省略至天黑透后，独孤起身')
add(4,'金水塾馆',8,
'门口管事攥竹筹面对灰衫独孤，室内两盏油灯与前排盘腿孩子入画；构图止于门口及前排。',
'中景','设计：静止','管事两问、独孤两答；管事塞白土笔并指屋内，令独孤代讲。','二人相对侧面；前排孩子侧背','管事左中景门口；独孤右中景；孩子下后景','粗粝日常',
'管事：识字？<br>独孤剑尘：认几个。<br>管事：会讲吐纳？<br>独孤剑尘：讲过几堂。<br>管事：上去。讲引气。','仅对白。','school-lamp-desk-axis',
[c('管事','左中景门口','侧面朝独孤','攥竹筹问话','塞白土笔，往屋里指'),c('独孤剑尘','右中景门口','侧面朝管事','回答两问','接白土笔'),c('前排孩子','下后景','侧背','盘腿坐地','仍盘腿坐地')],
[p('竹筹','管事手中','攥着'),p('白土笔','二人手间','一截完整白土笔'),p('油灯','室内','两盏'),p('旧布背囊','独孤背上','扎口紧')],
'管事与独孤在门口问答','独孤接白土笔，获代讲指令')
add(4,'金水塾馆',14,
'独孤在刷墨门板前，板书“沉”旁的白土笔断为两截，虎口厚茧沾笔灰；前排孩子仍盘腿听讲。',
'中近景','设计：静止','先说“灵气沉在下处。”，再写“沉”导致笔断，随后说吐纳口诀短句。','独孤侧面朝板；孩子侧背','门板上中格；独孤右中格；前排孩子下前景','平稳',
'独孤剑尘：灵气沉在下处。<br>独孤剑尘：吸气，舌抵上腭。<br>独孤剑尘：走不动就停。别硬压。','仅对白。','school-lamp-desk-axis',
[c('独孤剑尘','右中格板前','侧面朝板','先解释灵气沉在下处','写沉笔断后讲口诀'),c('前排孩子','下前景','侧背朝讲位','盘腿听讲','仍盘腿听讲')],
[p('刷墨门板','上中格','写出沉字'),p('白土笔','独孤手中','写沉时断成两截'),p('旧布背囊','独孤背上','扎口紧')],
'独孤先讲沉在下处','沉字已写，笔断两截，随后口诀说完')
add(4,'金水塾馆',9,
'抱柴杂役在门槛前栽，最上劈柴正擦小丫头发顶横转下落，独孤右鞋尖贴着木头中段；小丫头在前排蹲捡竹筹，管事在门口。',
'中景','设计：静止，一次完整挡柴动作','杂役绊倒；独孤右脚前移半寸，鞋尖贴木使其横转半圈砸地，随后收脚咽一口，断笔换左手写稳；管事看右脚一瞬又移开。','独孤侧面；杂役前倾侧面；小丫头俯身侧面；管事侧面','门槛左后景；劈柴与小丫头下中格；独孤右中格','骤紧后克制',
'无台词','劈柴落地闷响一声；随后灶房铁勺刮锅底。','school-lamp-desk-axis',
[c('独孤剑尘','右中格','侧面','右脚前移半寸，鞋尖贴劈柴中段','收脚咽一口，断笔换左手写稳'),c('抱柴杂役','左后景门槛','前倾侧面','抱柴绊倒前栽','站稳后回看地上木头'),c('小丫头','下中格前排','俯身侧面','蹲着捡竹筹','捡完竹筹揉膝坐回'),c('管事','门口后景','侧面','看独孤右脚','一瞬后移开目光')],
[p('劈柴','小丫头发顶上方','最上一根横转半圈后砸地，溅灯灰'),p('竹筹','小丫头手边','正捡拾'),p('白土笔','独孤左手','两截'),p('刷墨门板','独孤身旁','沉字下再写稳'),p('旧布背囊','独孤背上','扎口紧')],
'杂役绊倒，一根劈柴向小丫头后脑落下','劈柴已落地，独孤写稳，管事移开目光')
add(4,'金水塾馆',9,
'独孤停在第四排末尾，隔三排地砖约一丈半望向最后一排北墙角落。光到不了那里，角落少年只见盘腿轮廓，肩平背直，下巴微收，掌心朝下搁膝。',
'中远景','设计：极缓推；观察三十息以时间省略压缩','独孤搁笔后从第三排往后走，在第四排末尾站住观察；角落少年轮廓不动。','独孤侧背；少年暗处侧面轮廓；孩子侧背','独孤右中景第四排末尾；少年左后景北墙角落；孩子分列中景','凝神、警觉',
'无台词','按原文吐纳节拍：吸气时灯焰不动，呼气时门缝穿堂风不响。','school-lamp-desk-axis',
[c('独孤剑尘','右中景第四排末尾','侧背朝北墙角落','搁笔后从第三排往后走','第四排末尾站住观察'),c('角落少年','左后景北墙角落','暗处侧面轮廓','盘腿，掌心朝下搁膝','肩平背直，轮廓不动'),c('孩子们','两侧中景各排','侧背','盘腿坐着','仍盘腿坐着')],
[p('油灯','室内中景','两盏，吸气时灯焰不动'),p('旧布背囊','独孤背上','扎口紧')],
'独孤从第三排往后走','独孤在第四排末尾观察暗处轮廓')
add(5,'金水塾馆',8,
'管事在孩子掌心搁指甲盖大小的灰白碎灵石，女孩掌心一丝白光闪过即灭。油污名册在管事手里；画面限于点验处。',
'中近景','设计：静止','管事逐个点验，女孩白光一闪后再看两息，摇头判定；之后翻名册叫晏燎。','管事侧面；女孩及孩子侧面','管事右中格；女孩左下格；其他受验孩子后景','麻木',
'管事：灵根太杂。下一个。<br>管事：晏燎，到你了。','原文点验时竹筹照拨；名册不补翻页音。','school-lamp-desk-axis',
[c('管事','右中格','侧面','逐个点验','翻名册叫晏燎'),c('点验女孩','左下格','侧面','掌心放碎灵石','白光一闪即灭'),c('受验孩子们','后景','侧面','依次伸掌','点验继续')],
[p('碎灵石','女孩掌心','灰白、指甲盖大小，一丝白光闪灭'),p('名册','管事手中','油污浸满'),p('竹筹','管事手边','点验时照拨')],
'管事逐个点验','女孩白光已灭，管事翻册叫晏燎')
add(5,'金水塾馆',8,
'晏燎已走到管事面前，伸出细腕右掌，短袖露结痂旧擦伤；草绳裤腿与露趾草鞋入画。灰白碎片下极淡暗红在掌纹游半息，向手指走一截便灭；同瞬后景独孤背囊细颤。',
'中景','设计：静止','晏燎起身走到管事前伸右手；管事搁碎灵石；暗红亮起一瞬归元以背囊一次微颤表现，独孤此时不僵身挡囊。','晏燎侧面；管事侧面；独孤侧背','晏燎左中景点验处；管事右中景；独孤后景','无声暗涌',
'无台词','不为暗红或背囊微颤新增音效，不截断现场原有声场。','school-lamp-desk-axis',
[c('晏燎','左中景管事面前','侧面','从角落起身走来，伸右手','暗红在掌纹向手指行一截便灭'),c('管事','右中景','侧面','面对晏燎','把碎灵石搁其右掌'),c('独孤剑尘','后景','侧背','仍在塾馆','背囊同瞬微颤，此时没有僵身挡囊动作')],
[p('碎灵石','晏燎右掌','灰白底下渗极淡暗红，掌纹游半息后灭'),p('旧布背囊','独孤背上后景','暗红亮起一瞬细颤一次，扎口未启')],
'晏燎起身走向管事伸右手','暗红已灭，背囊同瞬一次微颤已发生')
add(5,'金水塾馆',11,
'管事手中碎片无光，晏燎收回右手转身，侧面瞳仁仍有两盏油灯倒影；北墙角落在深处。',
'中景','设计：静止','管事拿起碎片翻看再搁回，暗红未再亮；搁三息又看背面，说判定与散课话；晏燎收手走回角落盘腿坐下。','管事侧面；晏燎侧面转背面','管事右中景；晏燎中景至北墙后景','平淡否定',
'管事：灵根驳杂。<br>管事：不管饭。下一个，没了。都去灶房领粥。','仅对白；暗红未再亮，不补灵石声音。','school-lamp-desk-axis',
[c('管事','右中景','侧面','拿起碎片翻看再搁回','搁三息再看背面，判定散课'),c('晏燎','中景至北墙后景','侧面转背面','右手仍伸着','收手转身走回角落盘腿坐下')],
[p('碎灵石','管事手中与晏燎掌心','复验无光'),p('油灯','室内','两盏，瞳仁有倒影')],
'管事拿起碎片复验','晏燎已回北墙角落盘腿坐下')
add(5,'金水塾馆',8,
'门框旁独孤用身体挡住靠墙背囊扎绳，右手指节捏白；管事在门口清点竹筹，孩子们从前景去灶房。',
'中近景','设计：静止','接晏燎已回角落后，独孤后背僵半息，囊靠墙、身体挡绳，指节捏白又松，咽回血腥味。','独孤侧背；管事侧面；孩子背面','独孤右中格门框旁；管事左后景门口；孩子下前景','痛感、克制',
'无台词','灶房铁勺刮锅底，孩子领粥脚步声。','school-lamp-desk-axis',
[c('独孤剑尘','右中格门框旁','侧背','晏燎已坐回后才僵背半息','囊靠墙、身体挡绳，指节松开，咽回'),c('管事','左后景门口','侧面','清点竹筹','继续清点'),c('领粥孩子们','下前景','背面向灶房','排队领粥','脚步涌向灶房')],
[p('旧布背囊','独孤背后靠墙','身体挡住扎绳，已不再震'),p('竹筹','管事手中','清点')],
'晏燎已回角落，独孤才僵背半息','独孤咽回血腥味，囊已安静')
add(6,'悦来客栈最里间',15,
'漆黑最里间的窗框中，独孤扶窗久听，铁灰河雾打湿两鬓灰白；背囊在床根，对岸集市几盏灯笼在雾里晃着，一盏也没灭。隔壁弟子只在画外。',
'中景','设计：固定；同一机位以时间省略承接半个时辰后开窗','先木棍顶门、背囊靠床根、黑屋坐下，隔壁传谈话；半个时辰后起身推木窗，扶窗听，末段不摸扎绳、不再算路。','独孤侧背朝窗','独孤窗边中景；背囊床根下前景；对岸灯火远景','悬置、守望',
'宗门弟子：这道口镇的灵矿产量又涨了','隔壁对饮笑语；半个时辰后开窗才接码头至对岸矿场的铁链长拖声，持续收尾。','inn-room-window-axis',
[c('独孤剑尘','中景窗边','侧背朝窗','木棍顶门、背囊靠床根，在黑屋坐下','时间省略半个时辰后推窗，扶窗久听')],
[p('旧布背囊','下前景床根','扎口紧，留在床根'),p('木棍','门后','顶门'),p('木窗','独孤身前','半个时辰后推开'),p('灯笼','对岸集市远景','几盏在雾里晃着，一盏也没灭')],
'独孤顶门放囊后黑屋坐下，隔壁画外谈话','时间省略半个时辰后，独孤扶窗听链声')

# Production format is extracted from the frozen request rather than restated.
system = json.loads((BASE / 'storyboard-v1/prepared.json').read_text())['request']['system']
header = next(line for line in system.splitlines() if line.startswith('| 序号 | 画面描述 |'))
separator = '|'+ '|'.join(['------']*15)+'|'
titles = ['金水河码头','道口镇街道','客栈后院柴房','金水塾馆','金水塾馆点验','客栈最里间']
parts = ['<storyboardTable>']
for scene_no, title in enumerate(titles, 1):
    selected = [r for r in rows if r['sceneNo'] == scene_no]
    people = list(dict.fromkeys(c['name'] for r in selected for c in r['fields'][14]['visibleCharacters']))
    parts += [f'## 场{scene_no}：{title} ｜ 参演角色：'+ '、'.join(people), f'### 片段{scene_no}（约{sum(r["fields"][4] for r in selected)}s）', header, separator]
    for row in selected:
        cells = [('['+', '.join(v)+']') if isinstance(v,list) else json.dumps(v,ensure_ascii=False,separators=(',',':')) if isinstance(v,dict) else str(v) for v in row['fields']]
        assert all('|' not in cell and '\n' not in cell for cell in cells)
        parts.append('| ' + ' | '.join(cells) + ' |')
parts.append('</storyboardTable>')
output = '\n\n'.join(parts)+'\n'
(OUT / 'output.md').write_text(output)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
inputs = [SNAP/'input.json',SNAP/'snapshot.json',BASE/'text-v3/script.md',BASE/'planning-v2/plan.md',BASE/'storyboard-v1/prepared.json',BASE/'storyboard-v1/send/output.md',ROOT/'apps/frontend/lib/studio/storyboard-table.ts'] + catalogue_files
missing = sorted({n for r in rows for n in r['fields'][3] if len(catalogue.get(aliases.get(n,n),[])) != 1})
checks = {
    'shots':len(rows),'sceneShotCounts':[sum(r['sceneNo']==i for r in rows) for i in range(1,7)],
    'sceneDurations':[sum(r['fields'][4] for r in rows if r['sceneNo']==i) for i in range(1,7)],
    'totalSeconds':sum(r['fields'][4] for r in rows),'minShotSeconds':min(r['fields'][4] for r in rows),'maxShotSeconds':max(r['fields'][4] for r in rows),
    'dialogueExcerptsSourceExact':True,'visibleCharacterMembership':True,'knownViewpoints':True,
    'missingCatalogueNames':missing,'scope':'deterministic checks only; not semantic audit or PRIMARY approval'
}
for r in rows:
    f=r['fields']; s=f[14]
    assert all(c['name'] in f[3] for c in s['visibleCharacters'])
    if f[11]!='无台词':
        for line in f[11].split('<br>'):
            excerpt=line.split('：',1)[1]
            assert excerpt in source['chapterText'], (f[0],excerpt)
    # Four Chinese characters/sec is the production spoken upper boundary.
    spoken = ''.join(x.split('：',1)[1] for x in f[11].split('<br>')) if f[11]!='无台词' else ''
    assert len(re.findall(r'[\u4e00-\u9fff]',spoken))<=4*f[4],f[0]
assert checks['sceneDurations']==[35,40,15,40,35,15] and checks['shots']==18
(OUT/'local-checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n')
provenance = {
 'authorship':'PRIMARY editorial revision by implement-storyboard-compact; not a GLM completion',
 'modelCalls':0,'projectWrites':0,'approvalStatus':'not requested or represented; pending root review and independent model audit',
 'outputSha256':sha(OUT/'output.md'),'inputs':[{'path':str(p),'sha256':sha(p)} for p in inputs],
 'sourceTextSha256':hashlib.sha256(source['chapterText'].encode()).hexdigest(),
 'aliases':aliases,'missingIdsPolicy':'Unknown catalogue names remain in per-shot names and semantics; no invented IDs; ID array contains only exact verified matches.',
 'viewpointPolicy':'Existing frozen continuityAssetVersions IDs only. Sc3 street-main-axis expressly includes 柴房缺口; dedicated 柴房 viewpoint absent. Asset catalogue aliases are not new scene versions.',
 'referenceLimit':'Existing image/layout/style records do not override chapter facts: no tables/benches, lamp colors, moonlight or view toward school imported from old references.',
 'correctedFacts':['Complete 18 shots and 180 seconds; truncated v1 preserved.','Zhaosi begins on highest platform/anchor.','Curse precedes shoulder collision.','Explain 沉 then write 沉 and break chalk then口诀.','Exactly one firewood deflection.','Dugu observes from fourth-row end; corner silhouette remains dark.','Yanliao walks to steward for dark-red test; same-instant single bag tremor; Dugu reaction only after Yanliao returns.','Half-hour elision before window opening.','All visible humans and groups registered; offscreen women/disciples not registered.','No invented sound source, light color, lamp movement, aura or sword sound.'],
 'productionParserNote':'15-column legacy parser assigns sceneIndex by distinct scene cell. Sc4/Sc5 share 金水塾馆 and thus one parser sceneIndex; six editorial scene budgets are checked from explicit headings. No production modification.'
}
(OUT/'provenance.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'output':str(OUT/'output.md'),'sha256':provenance['outputSha256'],'checks':checks},ensure_ascii=False))
