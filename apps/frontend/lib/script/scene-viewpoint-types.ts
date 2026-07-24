/**
 * Scene viewpoint definition shared by the generator and its pure layout helpers.
 * Keeping this contract independent prevents a type-only import cycle between
 * the public generator façade and the extracted layout module.
 */
export interface SceneViewpoint {
  id: string;
  name: string;
  nameEn: string;
  shotIds: string[];
  keyProps: string[];
  keyPropsEn: string[];
  description: string;
  descriptionEn: string;
  gridIndex: number;
}
