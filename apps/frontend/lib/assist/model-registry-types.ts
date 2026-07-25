export interface ModelInput {
  type: 'string' | 'integer' | 'number' | 'array';
  enum?: (string | number)[];
  minValue?: number;
  maxValue?: number;
  step?: number;
  default?: any;
  description?: string;
  isEdit?: boolean;
  maxItems?: number;
}

export interface BaseModel {
  id: string;
  name: string;
  endpoint?: string;
  category?: 'premium' | 'open-source' | 'fast' | 'latest';
  inputs: Record<string, ModelInput>;
  /** 供应商侧的模型 ID 别名列表（用于匹配供应商实际拥有的模型）。省略时以 id 本身做 fallback。 */
  providerAliases?: string[];
}

export type T2IModel = BaseModel;
export type T2VModel = BaseModel;
