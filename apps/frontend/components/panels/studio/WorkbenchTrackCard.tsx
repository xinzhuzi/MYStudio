import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { ToonflowWorkbenchTrack } from "@/lib/studio/workbench-view-model";
import { Play } from "lucide-react";

export function WorkbenchTrackCard(props: {
  track: ToonflowWorkbenchTrack;
  renderingTrackId: string | null;
  renderTrack: (trackId: string) => void;
  selectVideoCandidate: (trackId: string, videoId: string) => void;
  deleteVideoCandidate: (candidateId: string) => void;
}) {
  const { track } = props;
  return (
    <Card className="overflow-hidden rounded-lg">
      <CardHeader className="grid gap-3 border-b border-border bg-muted/35 py-3 lg:grid-cols-[180px_minmax(0,1fr)_minmax(0,auto)]">
        <div>
          <CardTitle className="text-sm">{track.name}</CardTitle>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{track.duration}s</span>
            <span>{track.state}</span>
            <span>{track.medias.length} medias</span>
          </div>
        </div>
        <div className="min-w-0">
          <Textarea
            readOnly
            value={track.prompt || ""}
            placeholder="prompt"
            className="min-h-[70px] resize-none bg-background text-xs"
          />
          {track.reason ? (
            <div className="mt-1 text-xs text-destructive">
              {track.reason}
            </div>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-start justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled>
            <span className="whitespace-normal leading-tight">检查提示词</span>
          </Button>
          <Button
            size="sm"
            onClick={() => props.renderTrack(track.id)}
            disabled={props.renderingTrackId === track.id}
          >
            <Play className="h-4 w-4" />
            <span className="whitespace-normal leading-tight">
              {props.renderingTrackId === track.id ? "生成中" : "生成视频"}
            </span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="min-w-0 space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {track.medias.map((media, index) => (
              <div
                key={`${media.sources}-${media.id}-${media.fileType}-${index}`}
                className="overflow-hidden rounded-md border border-border bg-background"
              >
                <div className="aspect-video bg-black">
                  {media.fileType === "audio" ? (
                    <div className="flex h-full items-center justify-center text-xs text-zinc-300">
                      audio
                    </div>
                  ) : media.fileType === "video" ? (
                    <video
                      className="h-full w-full object-cover"
                      src={toPreviewSrc(media.src)}
                      muted
                    />
                  ) : (
                    <img
                      className="h-full w-full object-cover"
                      src={toPreviewSrc(media.src)}
                      alt={media.name ?? media.id}
                    />
                  )}
                </div>
                <div className="space-y-1 p-2">
                  <Badge variant="outline">
                    {media.sources}/{media.fileType}
                  </Badge>
                  <div className="truncate text-xs">{media.name ?? media.id}</div>
                </div>
              </div>
            ))}
            {track.medias.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
                no media
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid min-w-0 gap-2">
          {track.videoList.map((video) => (
            <div
              key={video.id}
              className="rounded-md border border-border bg-background p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <Badge
                  variant={
                    video.state === "ready"
                      ? "default"
                      : video.state === "failed"
                        ? "destructive"
                        : "outline"
                  }
                >
                  {video.state}
                </Badge>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={video.selected ? "default" : "secondary"}
                    onClick={() =>
                      props.selectVideoCandidate(track.id, video.id)
                    }
                  >
                    选择
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => props.deleteVideoCandidate(video.id)}
                  >
                    删除
                  </Button>
                </div>
              </div>
              {video.path ? (
                <video
                  className="mt-2 aspect-video w-full rounded bg-black"
                  src={toPreviewSrc(video.path)}
                  controls
                />
              ) : null}
              {video.errorReason ? (
                <div className="mt-2 text-xs text-destructive">
                  {video.errorReason}
                </div>
              ) : null}
            </div>
          ))}
          {track.videoList.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
              no video
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function toPreviewSrc(filePath: string) {
  if (
    filePath.startsWith("local-image://") ||
    filePath.startsWith("file://") ||
    filePath.startsWith("project-file://") ||
    filePath.startsWith("data:") ||
    filePath.startsWith("blob:") ||
    filePath.startsWith("http://") ||
    filePath.startsWith("https://")
  )
    return filePath;
  return `file://${filePath}`;
}
