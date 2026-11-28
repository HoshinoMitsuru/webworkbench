---
name: C公益共享创作画布
description: 用内容节点组织同一场活动的共同创作
colors:
  primary: "#1F2328"
  primary-soft: "#F1F1EE"
  canvas: "#FAFAF8"
  paper: "#FFFFFF"
  ink: "#16181B"
  muted: "#62666B"
  border: "#E2E2DE"
  confirmed: "#2F6B53"
  confirmed-soft: "#EAF4EF"
  warning: "#7A5A12"
  warning-soft: "#FBF3DE"
typography:
  title:
    fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif'
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif'
    fontSize: "16px"
    lineHeight: 1.6
rounded:
  control: "8px"
  node: "14px"
  dialog: "16px"
spacing:
  compact: "8px"
  field: "18px"
  panel: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
---
# Design System: C公益共享创作画布

## Overview

同一活动的创作桌面。日常办公的明亮环境下，以白色文档、近白画布和清晰的炭黑选择状态支持长时间操作。原有中文系统字体、简明边框与低动效原则延续；旧版黑白阶段栏和强制交接主线由最新共享画布决策替代。

## Colors

炭黑表示当前选择和主要操作，绿色及文字表示确认，琥珀色及文字表示上游来源待处理。正文与辅助文字均采用高对比深色。图像背景仅是演示模板内容，不作为业务状态。

## Typography

项目标题22px，节点标题18px，节点内容17px，图文标题22—23px，正文编辑16px，辅助信息13—14px。画布缩放会缩小整个节点，专注编辑使用完整字号。

## Layout

顶部项目、成员、保存状态；下方四步主线及平台直接定位；其余空间为可平移缩放的创作画布。排期、主题、方案只有一条主线，平台节点从方案分叉。选中节点的操作紧邻标题栏，避免长文将动作推到视口外。窄屏页头重排，专注编辑为单列。

## Elevation & Depth

节点用完整边框区分，不使用卡片投影。受保护的专注编辑使用白色对话框、遮罩和柔和投影；短确认只用于替换内容等有损选择。

## Shapes

节点14px圆角，按钮8px，对话框16px。SVG几何线条用于图标和引用线。配图是明确的排版模板，不伪装成现场图或AI真实照片。

## Components

- 节点标题栏可拖动，方向键及移动按钮提供替代；点击卡片直接编辑。编辑入口常显，讨论、历史和移动工具随选中状态显示。
- 自动保存不打断输入；模型运行有生成状态和重复调用保护。错误保留输入。
- 标题、正文、配图独立修改与重生成；覆盖某一项之前保留历史快照。
- 引用线由画布位置计算；小红书分支默认绕过公众号卡片。
- 版本、评论与成员面板按需打开；@标明仅本地记录。
- 焦点环、选中文字、插入光标与滚动条使用同一色系；减少动态效果的系统设置被尊重。

## Do's and Don'ts

使用真实可预览的演示内容。保护手改稿，记录确认人与版本。上游变化只提示关联平台。全图用于理解关系，专注编辑用于阅读长文。不得将本地署名、模板生成或@记录说成真实协作、模型服务或通知。
