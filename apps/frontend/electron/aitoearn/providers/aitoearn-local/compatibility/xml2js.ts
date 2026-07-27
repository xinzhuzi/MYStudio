interface XmlObject {
  [key: string]: XmlValue[];
}

type XmlValue = XmlObject | string[];

function escapeXml(value: unknown) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildNode(name: string, value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => buildNode(name, item)).join("");
  if (value && typeof value === "object") {
    return `<${name}>${Object.entries(value).map(([key, child]) => buildNode(key, child)).join("")}</${name}>`;
  }
  return `<${name}>${escapeXml(value ?? "")}</${name}>`;
}

export class Builder {
  constructor(private readonly options: { rootName?: string } = {}) {}

  buildObject(value: Record<string, unknown>) {
    const rootName = this.options.rootName ?? "root";
    return buildNode(rootName, value);
  }
}

export class Parser {
  parseString(xml: string, callback: (error: Error | null, result?: XmlValue) => void) {
    try {
      const document = xml.replace(/<\?xml[^>]*>/g, "").trim();
      const parseElement = (source: string): XmlValue => {
        const match = source.match(/^<([^\s/>]+)[^>]*>([\s\S]*)<\/\1>$/);
        if (!match) return [source];
        const result: XmlObject = {};
        const body = match[2];
        const childPattern = /<([^\s/>]+)[^>]*>([\s\S]*?)<\/\1>/g;
        let child: RegExpExecArray | null;
        let consumed = "";
        while ((child = childPattern.exec(body))) {
          const key = child[1];
          const value = parseElement(`<${key}>${child[2]}</${key}>`);
          const existing = result[key];
          result[key] = existing ? [...existing, value] : [value];
          consumed += child[0];
        }
        if (!consumed && body.trim()) return [body.trim()];
        return result;
      };
      const rootMatch = document.match(/^<([^\s/>]+)[^>]*>[\s\S]*<\/\1>$/);
      if (!rootMatch) throw new Error("XML 根节点无效");
      callback(null, { [rootMatch[1]]: [parseElement(document)] });
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
