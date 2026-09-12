// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app } from "/scripts/app.js";

/**
 * 环节节点 canvas 自绘兜底(stage-canvas 模块,09-13 模块拆分)。
 * 主渲染=stage-node.js(官方 addDOMWidget DOM 排版);本模块在 DOM 扩展
 * 缺席时兜底,实例级 onDrawBackground 覆写静音。
 */

import { THEME, BRIDGE_URL, BRIDGE_TOKEN } from "./theme.js";

// ── 环节节点富内容自绘 v3(09-12 用户终裁×2:内容全量**+功能完备+精致**)──
// v3 增量:①动作按钮行(老画布节点按钮回流:生成导演规划/生成分镜表=付费金,
// 一键生图/一键生成所有视频/重建轨道;点击→bridge_actions→宿主老画布同款
// 派发器);②精致化(标题带/斑马行/磁贴描边/预览标题胶囊/按钮态)。
// 载荷=生成器写进 properties.manyingStage(v2:全量正文行/缩略图 tiles/表行/
// 逐镜双状态/资产分组/轨道全列);布局标尺与生成器 STAGE_METRICS 同源
// (headerTop=150,contentTop=218,lineH=15,tileH=100,tilesPerRow=6)。
// collapsed 或无载荷=不画(旧文件优雅退化,原生 widget 照常)。
app.registerExtension({
  name: "manying.stage.render",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "ManyingStage") return;
    const STAGE_COLORS = {
      ready: THEME.ok, pending: THEME.pending, empty: THEME.idle, warning: "#e06c75",
    };
    const PAID_GOLD = "#e6b054"; // 付费云端动作(--paid 亮档,画布深底可读)
    const HEADER_TOP = 150;
    const CONTENT_TOP = 218;
    const LINE_H = 15;
    const TILE_H = 100;
    const TILES_PER_ROW = 6;
    const ACTION_ROW_H = 44; // 与生成器 STAGE_METRICS.actionRowH 同源
    const SKILL_ROW_H = 20;  // 技能芯片行(v4)
    const ASSET_CARD_H = 76; // 资产卡行高(v4:64 卡 + 12 间距)
    const ASSETS_PER_ROW = 3;
    const stageImages = new Map(); // filename -> {img, tries}(缩略图缓存+限次重试)
    const ensureStageImage = (name) => {
      if (!stageImages.has(name)) {
        const img = new Image();
        const entry = { img, tries: 0 };
        img.onload = () => { if (app.canvas?.setDirty) app.canvas.setDirty(true, true); };
        // 09-12 真跑根修兜底:引擎就绪瞬保鲜链补传,文件可能晚于画布首绘到——
        // 404 不永久留白:2.5s 后换缓存戳重试,至多 3 次;仍败=占位(best-effort 契约)
        img.onerror = () => {
          entry.tries += 1;
          if (entry.tries <= 3 && stageImages.get(name) === entry) {
            setTimeout(() => {
              if (stageImages.get(name) === entry) {
                img.src = `/view?filename=${encodeURIComponent(name)}&subfolder=&type=input&_=${Date.now()}`;
              }
            }, 2500);
          }
        };
        img.src = `/view?filename=${encodeURIComponent(name)}&subfolder=&type=input&_=${Date.now()}`;
        stageImages.set(name, entry);
      }
      return stageImages.get(name).img;
    };
    const roundBox = (ctx, x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };
    nodeType.prototype.onDrawBackground = function (ctx) {
      const payload = this.properties?.manyingStage;
      if (!payload || this.flags?.collapsed) return;
      const w = this.size[0] - 10;
      const bottom = this.size[1] - 6;
      if (bottom - CONTENT_TOP < 40) return;
      const statusColor = STAGE_COLORS[payload.status] || THEME.idle;
      ctx.save();
      try {
        // ── 头区:左缘状态色条+标题+状态点文案+导出徽章+描述+指标芯片 ──
        // 精致化:头区衬带(标题/状态/描述/指标的整块底,浅圆角)
        ctx.fillStyle = "rgba(255,255,255,0.035)";
        roundBox(ctx, 10, HEADER_TOP - 10, w - 8, CONTENT_TOP - HEADER_TOP - 2, 8);
        ctx.fill();
        ctx.fillStyle = statusColor;
        roundBox(ctx, 6, HEADER_TOP - 8, 3.5, bottom - HEADER_TOP + 6, 2);
        ctx.fill();
        let y = HEADER_TOP;
        ctx.font = "600 13px sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.94)";
        ctx.fillText(String(payload.title || ""), 14, y + 10);
        ctx.font = "10px sans-serif";
        const statusText = String(payload.statusText || "");
        const stWidth = ctx.measureText(statusText).width;
        ctx.fillStyle = statusColor;
        ctx.fillText(statusText, w - stWidth, y + 10);
        ctx.beginPath();
        ctx.arc(w - stWidth - 7, y + 6.5, 3, 0, Math.PI * 2);
        ctx.fill();
        if (payload.finalExport) {
          ctx.fillStyle = THEME.accent;
          ctx.fillText("已导出成片", w - stWidth - 74, y + 10);
        }
        y += 22;
        ctx.font = "10px sans-serif";
        ctx.fillStyle = THEME.text2;
        ctx.fillText(String(payload.description || "").slice(0, 40), 14, y + 8);
        y += 20;
        let x = 14;
        for (const metric of (payload.metrics || []).slice(0, 4)) {
          const label = String(metric);
          const chipWidth = ctx.measureText(label).width + 12;
          if (x + chipWidth > w - 4) break;
          ctx.fillStyle = "rgba(255,255,255,0.07)";
          roundBox(ctx, x, y, chipWidth, 16, 4);
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.78)";
          ctx.fillText(label, x + 6, y + 11.5);
          x += chipWidth + 6;
        }
        // ── 内容框(裁剪安全:生成器已按内容定高,这里 clip 兜底) ──
        const boxTop = CONTENT_TOP;
        const boxHeight = bottom - boxTop - 2;
        ctx.fillStyle = "rgba(0,0,0,0.30)";
        roundBox(ctx, 12, boxTop, w - 6, boxHeight, 8);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.save();
        roundBox(ctx, 12, boxTop, w - 6, boxHeight, 8);
        ctx.clip();
        const innerX = 20;
        const innerW = w - 6 - 16;
        let iy = boxTop + 15;
        if (payload.previewTitle) {
          ctx.font = "600 9px sans-serif";
          const pillW = ctx.measureText(payload.previewTitle).width + 12;
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          roundBox(ctx, innerX - 4, iy - 10, pillW, 14, 7);
          ctx.fill();
          ctx.fillStyle = THEME.text2;
          ctx.fillText(payload.previewTitle, innerX + 2, iy);
          iy += 16;
        }
        // 参与技能芯片(v4 老画布 skills 徽标;超出右缘截断)
        if (Array.isArray(payload.skills) && payload.skills.length > 0) {
          let sx = innerX;
          ctx.font = "9px sans-serif";
          for (const skillName of payload.skills) {
            const label = String(skillName);
            const chipW = ctx.measureText(label).width + 14;
            if (sx + chipW > innerX + innerW) break;
            ctx.fillStyle = THEME.accentDim;
            roundBox(ctx, sx, iy - 9, chipW, 14, 7);
            ctx.fill();
            ctx.strokeStyle = "rgba(110,168,254,0.35)";
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = THEME.accent;
            ctx.fillText(label, sx + 7, iy + 1);
            sx += chipW + 6;
          }
          iy += SKILL_ROW_H;
        }
        if (Array.isArray(payload.tiles) && payload.tiles.length > 0) {
          // 分镜 tiles:6 列缩略图格(84 图+标题;缺图=深底占位+态点)
          const cellW = innerW / TILES_PER_ROW;
          for (let i = 0; i < payload.tiles.length; i += 1) {
            const tile = payload.tiles[i];
            const col = i % TILES_PER_ROW;
            const row = Math.floor(i / TILES_PER_ROW);
            const cx = innerX + col * cellW;
            const cy = boxTop + 10 + row * TILE_H;
            const imgW = cellW - 10;
            ctx.fillStyle = "rgba(255,255,255,0.05)";
            roundBox(ctx, cx, cy, imgW, 84, 6);
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.10)";
            ctx.lineWidth = 1;
            ctx.stroke();
            const img = tile.preview ? ensureStageImage(tile.preview) : null;
            if (img && img.complete && img.naturalWidth) {
              const scale = Math.min(imgW / img.naturalWidth, 84 / img.naturalHeight);
              const dw = img.naturalWidth * scale;
              const dh = img.naturalHeight * scale;
              ctx.drawImage(img, cx + (imgW - dw) / 2, cy + (84 - dh) / 2, dw, dh);
            } else {
              ctx.font = "600 12px sans-serif";
              ctx.fillStyle = THEME.text2;
              const idx = `#${tile.index}`;
              ctx.fillText(idx, cx + (imgW - ctx.measureText(idx).width) / 2, cy + 46);
            }
            const dot = tile.hasVideo ? THEME.accent : tile.hasImage ? THEME.ok : THEME.idle;
            ctx.fillStyle = dot;
            ctx.beginPath();
            ctx.arc(cx + imgW - 8, cy + 8, 3.5, 0, Math.PI * 2);
            ctx.fill();
            if (tile.state) {
              ctx.font = "8px sans-serif";
              ctx.fillStyle = THEME.text2;
              const st = String(tile.state).slice(0, 6);
              const stw = ctx.measureText(st).width;
              ctx.fillText(st, cx + imgW - stw - 4, cy + 79);
            }
            ctx.font = "9px sans-serif";
            ctx.fillStyle = "rgba(255,255,255,0.72)";
            ctx.fillText(`#${tile.index} ${tile.title}`, cx + 3, cy + 97, imgW - 6);
            if (tile.lines) {
              ctx.font = "8px sans-serif";
              ctx.fillStyle = THEME.text2;
              ctx.fillText(tile.lines, cx + 3, cy + 108, imgW - 6);
            }
          }
        } else if (Array.isArray(payload.tableRows) && payload.tableRows.length > 0) {
          // 分镜表行:#N 场景 · 描述 · 景别 · 时长
          ctx.font = "11px sans-serif";
          for (let ri = 0; ri < payload.tableRows.length; ri += 1) {
            const row = payload.tableRows[ri];
            const twoLine = Boolean(row.lines || row.sound || row.assets);
            if (ri % 2 === 1) {
              ctx.fillStyle = "rgba(255,255,255,0.028)";
              ctx.fillRect(innerX - 4, iy - 11, innerW + 8, twoLine ? LINE_H * 2 + 2 : LINE_H);
            }
            // 首行:镜号/场景/描述/景别·运镜/时长
            ctx.fillStyle = "rgba(255,255,255,0.55)";
            ctx.fillText(`#${String(row.index).padStart(2, "0")}`, innerX, iy);
            ctx.fillStyle = "rgba(255,255,255,0.8)";
            ctx.fillText(row.scene, innerX + 34, iy);
            ctx.fillText(row.title, innerX + 108, iy);
            const right = [
              [row.shotSize, row.cameraMove].filter(Boolean).join("·"),
              row.duration ? `${row.duration}s` : "",
            ].filter(Boolean).join(" · ");
            ctx.fillStyle = THEME.text2;
            const rw = ctx.measureText(right).width;
            ctx.fillText(right, innerX + innerW - rw, iy);
            iy += LINE_H;
            // 次行:台词(斜灰)/表演/声音/关联资产
            if (twoLine) {
              ctx.font = "10px sans-serif";
              ctx.fillStyle = "rgba(255,255,255,0.6)";
              const sub = [
                row.lines ? `“${row.lines}”` : "",
                row.action,
                row.sound,
                row.assets ? `【${row.assets}】` : "",
              ].filter(Boolean).join("  ");
              ctx.fillText(sub, innerX + 34, iy, innerW - 40);
              iy += LINE_H + 2;
              ctx.font = "11px sans-serif";
            }
          }
        } else if (Array.isArray(payload.shots) && payload.shots.length > 0) {
          // 逐镜队列:#N 标签 + 配音/视频双状态徽章(照老画布 remotionShots)
          ctx.font = "11px sans-serif";
          for (let ri = 0; ri < payload.shots.length; ri += 1) {
            const shotItem = payload.shots[ri];
            if (ri % 2 === 1) {
              ctx.fillStyle = "rgba(255,255,255,0.028)";
              ctx.fillRect(innerX - 4, iy - 11, innerW + 8, LINE_H);
            }
            ctx.fillStyle = "rgba(255,255,255,0.82)";
            ctx.fillText(`#${String(shotItem.index).padStart(2, "0")} ${shotItem.label}`, innerX, iy);
            const badges = [];
            // 队列实时态(v4:渲染器进程注入;最左优先)
            if (shotItem.status === "running") {
              badges.push([`渲染中 ${Math.round((shotItem.progress ?? 0) * 100)}%`, THEME.accent]);
            } else if (shotItem.status === "failed") badges.push(["失败", "#e06c75"]);
            else if (shotItem.status === "blocked") badges.push(["阻塞", THEME.pending]);
            else if (shotItem.status === "queued") badges.push(["排队", THEME.text2]);
            if (shotItem.ttsReady) badges.push(["配音✓", THEME.ok]);
            if (shotItem.sfxReady) badges.push(["音效✓", THEME.ok]);
            if (shotItem.videoReady) badges.push(["视频✓", THEME.accent]);
            else if (shotItem.imageReady && !shotItem.status) badges.push(["待出", THEME.pending]);
            else if (!shotItem.status && !shotItem.imageReady) badges.push(["未生成", THEME.idle]);
            if (shotItem.revision > 1) badges.push([`v${shotItem.revision}`, THEME.text2]);
            if (shotItem.status === "running") {
              const pct = Math.max(0, Math.min(1, shotItem.progress ?? 0));
              const barW = 44;
              const barX = innerX + innerW - 150;
              ctx.fillStyle = "rgba(255,255,255,0.10)";
              ctx.fillRect(barX, iy - 6, barW, 4);
              ctx.fillStyle = THEME.accent;
              ctx.fillRect(barX, iy - 6, Math.round(barW * pct), 4);
            }
            let bx = innerX + innerW;
            for (let b = badges.length - 1; b >= 0; b -= 1) {
              const [text, color] = badges[b];
              ctx.fillStyle = color;
              const tw = ctx.measureText(text).width;
              bx -= tw + 10;
              ctx.fillText(text, bx, iy);
              ctx.beginPath();
              ctx.arc(bx - 5, iy - 3.5, 3, 0, Math.PI * 2);
              ctx.fill();
            }
            iy += LINE_H;
          }
        } else if (Array.isArray(payload.assets) && payload.assets.length > 0) {
          // 资产卡(v4 老画布 assetGroups 卡片):封面缩略+名+类别+生成态,3 列
          const cardW = innerW / ASSETS_PER_ROW;
          const stageAssetImages = ensureStageImage;
          for (let ai = 0; ai < payload.assets.length; ai += 1) {
            const card = payload.assets[ai];
            const col = ai % ASSETS_PER_ROW;
            const row = Math.floor(ai / ASSETS_PER_ROW);
            const ax = innerX + col * cardW;
            const ay = boxTop + 10 + row * ASSET_CARD_H;
            if (ay + 64 > boxTop + boxHeight - 4) break;
            ctx.fillStyle = "rgba(255,255,255,0.05)";
            roundBox(ctx, ax, ay, cardW - 10, 64, 8);
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.10)";
            ctx.lineWidth = 1;
            ctx.stroke();
            const cover = card.cover ? stageAssetImages(String(card.cover)) : null;
            if (cover && cover.complete && cover.naturalWidth) {
              const sc = Math.min(52 / cover.naturalWidth, 52 / cover.naturalHeight);
              const cw = cover.naturalWidth * sc;
              const ch = cover.naturalHeight * sc;
              ctx.save();
            roundBox(ctx, ax + 6, ay + 6, 52, 52, 6);
            ctx.clip();
            ctx.drawImage(cover, ax + 6 + (52 - cw) / 2, ay + 6 + (52 - ch) / 2, cw, ch);
            ctx.restore();
            } else {
              ctx.fillStyle = "rgba(255,255,255,0.06)";
            roundBox(ctx, ax + 6, ay + 6, 52, 52, 6);
            ctx.fill();
              ctx.font = "600 14px sans-serif";
              ctx.fillStyle = THEME.text2;
              ctx.fillText(String(card.name || "?").slice(0, 1), ax + 26, ay + 36);
            }
            ctx.font = "600 10px sans-serif";
            ctx.fillStyle = "rgba(255,255,255,0.88)";
            ctx.fillText(String(card.name || "").slice(0, 8), ax + 64, ay + 20, cardW - 78);
            ctx.font = "8px sans-serif";
            ctx.fillStyle = THEME.text2;
            ctx.fillText(String(card.typeLabel || ""), ax + 64, ay + 32, cardW - 78);
            if (card.state) {
              const stateColor = card.state === "生成失败" ? "#e06c75"
                : card.state === "已完成" ? THEME.ok
                : card.state === "生成中" ? THEME.pending : THEME.text2;
              ctx.fillStyle = stateColor;
              ctx.fillText(String(card.state), ax + 64, ay + 46, cardW - 78);
            }
          }
        } else if (payload.assetGroups) {
          // 资产分组:角色/场景/道具名全列(两名一行,照老画布资产预览)
          const groups = [
            ["角色", payload.assetGroups.characters],
            ["场景", payload.assetGroups.scenes],
            ["道具", payload.assetGroups.props],
          ];
          for (const [label, names] of groups) {
            ctx.font = "600 9px sans-serif";
            ctx.fillStyle = THEME.text2;
            ctx.fillText(`${label} ${names.length}`, innerX, iy);
            iy += 14;
            ctx.font = "11px sans-serif";
            if (names.length === 0) {
              ctx.fillStyle = THEME.idle;
              ctx.fillText("—", innerX, iy);
              iy += LINE_H;
            }
            for (let i = 0; i < names.length; i += 2) {
              ctx.fillStyle = "rgba(255,255,255,0.8)";
              ctx.fillText(names.slice(i, i + 2).join(" · "), innerX, iy);
              iy += LINE_H;
            }
            iy += 4;
          }
        } else if (Array.isArray(payload.tracks) && payload.tracks.length > 0) {
          ctx.font = "11px sans-serif";
          for (let ri = 0; ri < payload.tracks.length; ri += 1) {
            const track = payload.tracks[ri];
            if (ri % 2 === 1) {
              ctx.fillStyle = "rgba(255,255,255,0.028)";
              ctx.fillRect(innerX - 4, iy - 11, innerW + 8, LINE_H);
            }
            ctx.fillStyle = "rgba(255,255,255,0.82)";
            const trackBits = [
              track.name,
              track.count > 0 ? `${track.count} 镜` : "",
              track.mediaCount > 0 ? `${track.mediaCount} 素材` : "",
              track.duration > 0 ? `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, "0")}` : "",
            ].filter(Boolean).join(" · ");
            ctx.fillText(trackBits, innerX, iy);
            if (track.state) {
              ctx.fillStyle = track.state === "ready" ? THEME.ok : THEME.text2;
              const tw = ctx.measureText(track.state).width;
              ctx.fillText(track.state, innerX + innerW - tw, iy);
            }
            iy += LINE_H;
          }
        } else {
          // 正文全量行(生成器已换行,≤60 行)
          ctx.font = "11px sans-serif";
          for (const line of (payload.previewLines || [])) {
            ctx.fillStyle = "rgba(255,255,255,0.78)";
            ctx.fillText(String(line), innerX, iy);
            iy += LINE_H;
          }
        }
        ctx.restore();
        // ── 动作按钮行(老画布节点按钮回流;点击→bridge_actions→宿主) ──
        const actions = payload.actions || [];
        const rects = [];
        if (actions.length > 0) {
          const rowY = bottom - ACTION_ROW_H + 8;
          let bx = 14;
          for (const action of actions) {
            ctx.font = "600 11px sans-serif";
            const label = String(action.label || action.kind);
            const bw = Math.min(ctx.measureText(label).width + 26, w - 20);
            const disabled = Boolean(action.disabled);
            if (bx + Math.min(ctx.measureText(String(action.label || action.kind)).width + 26, w - 20) > w - 8) break; // 行宽守卫(多按钮拓展)
            const flash = this.__manyingActionFlash
              && this.__manyingActionFlash.kind === action.kind
              && Date.now() < this.__manyingActionFlash.until;
            const base = action.paid ? PAID_GOLD : THEME.accent;
            ctx.globalAlpha = disabled ? 0.32 : 1;
            ctx.fillStyle = action.paid ? "rgba(230,176,84,0.12)" : THEME.accentDim;
            roundBox(ctx, bx, rowY, bw, 27, 7);
            ctx.fill();
            ctx.strokeStyle = disabled ? "rgba(255,255,255,0.12)" : base + (action.paid ? "99" : "88");
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = disabled ? THEME.text2 : base;
            const tw = ctx.measureText(label).width;
            ctx.fillText(label, bx + (bw - tw) / 2, rowY + 17.5);
            if (flash) {
              ctx.strokeStyle = base;
              ctx.lineWidth = 2;
              roundBox(ctx, bx - 2, rowY - 2, bw + 4, 31, 9);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
            rects.push({ x: bx, y: rowY, w: bw, h: 27, kind: action.kind, disabled });
            bx += bw + 8;
          }
        }
        this.__manyingActionRects = rects;
      } finally {
        ctx.restore();
      }
    };
    // 命中:按钮区点击→提交 bridge 动作(宿主消费走老画布同款派发器)。
    // litegraph 以节点本地坐标调 onMouseDown;命中即消费(返回 true)。
    nodeType.prototype.onMouseDown = function (pos) {
      const rects = this.__manyingActionRects || [];
      for (const rect of rects) {
        if (rect.disabled) continue;
        if (pos && pos[0] >= rect.x && pos[0] <= rect.x + rect.w
          && pos[1] >= rect.y && pos[1] <= rect.y + rect.h) {
          this.__manyingActionFlash = { kind: rect.kind, until: Date.now() + 1200 };
          if (app.canvas?.setDirty) app.canvas.setDirty(true, true);
          fetch(`${BRIDGE_URL}/comfy/bridge/actions`, {
            method: "POST",
            headers: { "X-Manying-Image-Token": BRIDGE_TOKEN, "Content-Type": "application/json" },
            body: JSON.stringify({ kind: rect.kind }),
          }).catch(() => undefined);
          return true;
        }
      }
      return false;
    };
  },
});
