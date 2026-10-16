"""Scope copied official recipes and vocabulary to prevent generic model mandates."""
from qi21_prompt_revision import ROOT, write
S=ROOT/'.agents/skills'
plans={
'qwen-image-prompt-en/references/text-to-image.md':[
 ('Qwen-Image-2.1 accepts two prompt styles. Pick by scene complexity, not by taste.','Qwen-Image-2.1 accepts compact and detailed prompts. Pick the detail level by scene complexity. Daojie custom prompts default to Chinese, preserve source facts, and have no minimum word count. The English format below applies only when reproducing the official PE-T2I recipe.'),
 ('~20 sentences / 300–500 words','~20 sentences / 400–500 words (official PE-T2I recipe only)'),
 ("The skill's long-form rules above mirror that rewriter, so a hand-written prompt following them is equivalent.","The long-form rules above describe that rewriter's recipe; following them manually does not establish equivalent model output. Daojie custom Chinese prompts use the project layering contract instead."),
],
'qwen-image-2-1-prompter/references/cheat_sheet.md':[
 ('This cheat sheet provides quick vocabulary lookups for composing precise prompts matching Qwen-Image-2.1\'s semantic latent space.',"This cheat sheet is optional vocabulary for the official PE recipe, not mandatory prompt content or a model input contract. Daojie custom prompts use Chinese, source facts, the current layered rendering contract, and task-appropriate detail. Do not inject photographic, 3D, paper-texture, or lighting terms into Daojie by default."),
],
'qwen-image-2-1-prompter/references/edit_rules.md':[
 ('> **Role**: Expert at clarifying image editing instructions, attribute disentanglement, and multi-image compositing.', '> **Role**: Expert at clarifying image editing instructions, attribute disentanglement, and multi-image compositing.\n> **Scope**: official PE-I2I rewriting recipe. Daojie local edits only include the requested operation and preservation constraints; style conversion adds the requested painting method, and new assets use the project type layer. Refer only to images actually supplied; do not force extra references or a minimum prompt length.'),
],
}
for rel,pairs in plans.items():
 p=S/rel;s=p.read_text()
 for a,b in pairs:
  assert s.count(a)==1,(rel,a);s=s.replace(a,b)
 write(p,s,'技能参考资料同步：官方英文配方范围、字数纠正、局部编辑保留项及可选词表边界')
print('reference scope updated',len(plans))
