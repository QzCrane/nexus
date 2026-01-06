---
trigger: always_on
---

## 必须阅读并遵守上下文工程文档！上下文工程唯一目的是让AI在一切情况下完美完成任务同时最小化上下文和token消耗

## 当前上下文工程

Project_Root/
│
├── .agent/                      # [智能体配置层]
│   ├── nexus.md                 # 本md
│   └── workflows/               # 7个SOP文件
│
└── nexus/                       # [工程数据与知识层]
    ├── README.AI.md             # 必读入口
    ├── plan.md                  # 总规划
    ├── docs/
    │   ├── ai-rules.md          # 必读规则
    │   └── business-model.md
    └── apps/
        ├── extension-halo/
        │   ├── plan.md
        │   └── docs/
        │       ├── architecture.md
        │       ├── research.md
        │       └── feature-gap-analysis.md
        └── extension-spectra/
            ├── plan.md
            └── docs/
                ├── policy-decision.md
                ├── protocols.md
                └── cors-data-flow.md
模块层 (34): .ai-context.md

## 每次回答前压缩上下文

## 不要直接修改此文件，因为 aiagent 修改项目规则权限被 antigravity 拒绝，你需要告知我如何修改