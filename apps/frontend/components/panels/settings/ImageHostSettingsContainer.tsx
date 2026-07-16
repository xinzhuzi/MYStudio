import { useMemo, useState } from "react";
import { AddImageHostDialog } from "@/components/image-host-manager/AddImageHostDialog";
import { EditImageHostDialog } from "@/components/image-host-manager/EditImageHostDialog";
import { uploadToImageHost } from "@/lib/image-host";
import {
  isVisibleImageHostProvider,
  useAPIConfigStore,
  type ImageHostProvider,
} from "@/stores/api-config-store";
import { toast } from "sonner";
import { ImageHostSettingsTab } from "./ImageHostSettingsTab";

export function useImageHostSettings() {
  const {
    imageHostProviders,
    addImageHostProvider,
    updateImageHostProvider,
    removeImageHostProvider,
  } = useAPIConfigStore();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ImageHostProvider | null>(null);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const providers = useMemo(
    () => imageHostProviders.filter(isVisibleImageHostProvider),
    [imageHostProviders],
  );

  const editProvider = (provider: ImageHostProvider) => {
    setEditingProvider(provider);
    setEditOpen(true);
  };

  const deleteProvider = (providerId: string) => {
    removeImageHostProvider(providerId);
    toast.success("已删除图床");
  };

  const testProvider = async (provider: ImageHostProvider) => {
    setTestingProviderId(provider.id);
    try {
      const testImage = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
      const result = await uploadToImageHost(testImage, {
        expiration: 60,
        providerId: provider.id,
      });
      if (result.success) {
        toast.success(`图床 ${provider.name} 连接测试成功`);
      } else {
        toast.error(`测试失败: ${result.error || "未知错误"}`);
      }
    } catch {
      toast.error("连接测试失败，请检查网络");
    } finally {
      setTestingProviderId(null);
    }
  };

  return {
    providers,
    addOpen,
    setAddOpen,
    editOpen,
    setEditOpen,
    editingProvider,
    testingProviderId,
    addImageHostProvider,
    updateImageHostProvider,
    editProvider,
    deleteProvider,
    testProvider,
  };
}

export function ImageHostSettingsContainer() {
  const settings = useImageHostSettings();

  return (
    <>
      <ImageHostSettingsTab
        providers={settings.providers}
        testingProviderId={settings.testingProviderId}
        onAdd={() => settings.setAddOpen(true)}
        onUpdate={settings.updateImageHostProvider}
        onTest={settings.testProvider}
        onEdit={settings.editProvider}
        onDelete={settings.deleteProvider}
      />
      <AddImageHostDialog
        open={settings.addOpen}
        onOpenChange={settings.setAddOpen}
        onSubmit={settings.addImageHostProvider}
      />
      <EditImageHostDialog
        open={settings.editOpen}
        onOpenChange={settings.setEditOpen}
        provider={settings.editingProvider}
        onSave={settings.updateImageHostProvider}
      />
    </>
  );
}
