const ROLE_ATTRIBUTE_LABELS = new Set([
  "性别",
  "年龄",
  "身份",
  "出身背景",
  "出生地",
  "尊号",
  "境界",
  "势力",
  "组织归属",
]);

const WIDE_ROLE_ATTRIBUTE_LABELS = new Set([
  "出身背景",
  "出生地",
  "身份",
  "组织归属",
  "势力",
]);

export interface StudioAssetRoleAttribute {
  label: string;
  value: string;
}

export function parseStudioAssetRoleAttributes(
  setting: string,
): StudioAssetRoleAttribute[] {
  const fields: StudioAssetRoleAttribute[] = [];
  const regex = /[-*]\s*\*\*(.+?)\*\*[：:]\s*(.+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(setting)) !== null) {
    const label = match[1].trim();
    const value = match[2].trim();
    if (ROLE_ATTRIBUTE_LABELS.has(label)) {
      fields.push({ label, value });
    }
  }

  return fields;
}

export function StudioAssetRoleAttributes({ setting }: { setting: string }) {
  const fields = parseStudioAssetRoleAttributes(setting);
  if (fields.length === 0) return null;

  return (
    <section className="space-y-2 rounded-lg border border-border bg-muted/90 p-3 overflow-hidden">
      <div className="text-xs font-semibold text-foreground">人物属性</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {fields.map((field, index) => (
          <div
            key={`${field.label}-${index}`}
            className={`truncate ${WIDE_ROLE_ATTRIBUTE_LABELS.has(field.label) ? "col-span-2" : ""}`}
            title={`${field.label}：${field.value}`}
          >
            <span className="text-muted-foreground">{field.label}：</span>
            {field.value}
          </div>
        ))}
      </div>
    </section>
  );
}
