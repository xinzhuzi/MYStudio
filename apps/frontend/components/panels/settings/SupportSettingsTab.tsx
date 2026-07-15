import { Coffee } from "lucide-react";
import wechatPayImg from "@/assets/donate/wechat-pay.jpg";
import alipayPayImg from "@/assets/donate/alipay-pay.jpg";
import wechatFriendImg from "@/assets/donate/wechat-friend.jpg";
import { ScrollArea } from "@/components/ui/scroll-area";

export function SupportSettingsTab() {
  return (
    <ScrollArea className="h-full">
      <div className="p-8 w-full space-y-8">
        <div className="text-center space-y-2">
          <h3 className="text-2xl font-bold text-foreground flex items-center justify-center gap-2">
            <Coffee className="h-6 w-6 text-amber-500" />
            请作者喝杯咖啡
          </h3>
          <p className="text-sm text-muted-foreground">
            漫影工作室是免费开源项目，如果它对你有帮助，欢迎扫码请作者喝杯咖啡 ☕，你的支持是持续更新的动力。
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="rounded-xl border border-border bg-card p-5 text-center space-y-3">
            <p className="text-sm font-medium text-foreground">微信支付</p>
            <div className="bg-white rounded-lg p-3 inline-block">
              <img src={wechatPayImg} alt="微信收款码" className="w-full max-w-[240px] h-auto rounded" />
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5 text-center space-y-3">
            <p className="text-sm font-medium text-foreground">支付宝</p>
            <div className="bg-white rounded-lg p-3 inline-block">
              <img src={alipayPayImg} alt="支付宝收款码" className="w-full max-w-[240px] h-auto rounded" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 text-center space-y-3">
          <p className="text-sm font-medium text-foreground">联系作者</p>
          <p className="text-xs text-muted-foreground">竹海晨金 · 提需求、交流合作、反馈 Bug</p>
          <div className="bg-white rounded-lg p-3 inline-block">
            <img src={wechatFriendImg} alt="作者微信" className="w-full max-w-[240px] h-auto rounded" />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
