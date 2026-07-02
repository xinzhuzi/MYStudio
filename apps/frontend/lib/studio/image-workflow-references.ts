export interface PrepareImageWorkflowReferenceImagesDeps {
  readProjectFileAsBase64?: (
    url: string,
  ) => Promise<{ success: boolean; base64?: string; error?: string } | undefined>;
  readLocalImageAsBase64?: (url: string) => Promise<string | null | undefined>;
}

export async function prepareImageWorkflowReferenceImages(
  values: string[],
  deps: PrepareImageWorkflowReferenceImagesDeps,
) {
  const results: string[] = [];
  for (const value of values) {
    if (value.startsWith("project-file://")) {
      const result = await deps.readProjectFileAsBase64?.(value);
      if (!result?.success || !result.base64) {
        throw new Error(
          `项目内参考图读取失败：${result?.error || value}`,
        );
      }
      results.push(result.base64);
    } else if (value.startsWith("local-image://")) {
      results.push((await deps.readLocalImageAsBase64?.(value)) ?? value);
    } else {
      results.push(value);
    }
  }
  return results;
}
