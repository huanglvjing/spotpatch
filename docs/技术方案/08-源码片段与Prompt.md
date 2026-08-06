---
doc-id: "08-code-prompt"
title: "源码片段与 Prompt"
status: "active"
version: "1.0.0"
last-updated: "2026-08-06"
source-range: "规格书 §2.5、§16、§16.1–§16.2、§17、§17.1–§17.2"
参考文献/依赖:
  - "03-public-api-models"
  - "06-source-resolution"
  - "07-dom-css-collection"
  - "09-local-protocol-security"
  - "10-ui-diagnostics"
  - "12-testing-acceptance"
  - "15-risks-adr"
---

# 源码片段与 Prompt

v1 只在本地组织上下文，不调用 AI；该边界受 ADR-006 约束 (见 doc-id:15-risks-adr)。

## 上下文提取原则

提取“最相关上下文”，不是“全部上下文”。

无限制复制完整 DOM、完整源码和全部计算样式，会造成隐私风险、Prompt 噪声和 token 浪费。所有采集器必须执行预算和清洗策略。

预算数值由公共配置唯一给出 (见 doc-id:03-public-api-models)，DOM/CSS 采集范围由采集规范定义 (见 doc-id:07-dom-css-collection)，清洗规则由安全规范定义 (见 doc-id:09-local-protocol-security)。

## 源码片段提取

### v1 策略

1. 用选中行找到包围它的最小 JSX element。
2. 向 AST 祖先寻找函数组件、箭头函数组件或类组件。
3. 若识别到合理组件边界且不超过预算，返回组件代码。
4. 否则返回目标行前后各 30–40 行。
5. 所有行号保持为原文件行号。

选中行所对应的来源必须先按源码解析规范确定 (见 doc-id:06-source-resolution)。

### 组件识别规则

正式支持：

```tsx
function UserProfile() {}
const UserProfile = () => {};
const UserProfile = function UserProfile() {};
class UserProfile extends React.Component {}
export default function UserProfile() {}
export const UserProfile = memo(() => {});
export const UserProfile = forwardRef(function UserProfile() {});
```

降级到 nearby-lines：

- 动态组件工厂返回值。
- 多层未知 HOC。
- 对象属性中匿名函数组件。
- JSX 位于普通回调函数且无法确认所属组件。
- 单组件超过字符或行数预算。

输出必须包含 `boundary`，让用户和 AI 知道这是完整组件还是附近代码。

`CodeContext` 和 `boundary` 的数据定义只在公共模型中声明 (见 doc-id:03-public-api-models)。

## Prompt Composer

Prompt Composer 必须是纯函数：

```tsx
export interface PromptComposer {
  compose(annotation: SpotAnnotation): string;
}
```

`SpotAnnotation` 的唯一数据模型见公共 API 与数据模型 (见 doc-id:03-public-api-models)。

固定段落顺序：

1. 问题描述
2. 页面环境
3. React 上下文
4. 源码定位与置信度
5. 选中 DOM
6. 相关 CSS
7. 关键计算样式
8. 附近代码
9. 采集警告
10. 给编程助手的约束

### 默认输出

````markdown
## 问题

头像与用户名没有垂直居中。

## 页面环境

- URL: <http://localhost:5173/profile>
- Viewport: 1440 × 900

## React 上下文

- Component: UserProfile
- Stack: UserProfile > ProfilePage > App

## 源码定位

- File: src/components/UserProfile.tsx:36:5
- Origin: jsx-host
- Confidence: exact

## 选中元素

```html
<div class="user-info">...</div>
```

## 相关样式

```css
.user-info {
  display: flex;
  align-items: flex-start;
}
```

## 附近代码

```tsx
...
```

## 修改要求

请先判断根因，再给出最小范围修改。不要改动无关组件；如果上下文不足，请明确说明需要哪些信息。
````

### 预算策略

预算按优先级裁剪：

```text
问题描述、源码位置        永不删除
组件名、元素 opening tag  高优先级
命中 CSS、附近代码        中高优先级
父级 DOM、完整组件栈      中优先级
低价值 computed style     最先删除
```

字符预算只是可预测的本地限制，不宣称等于模型 token。中文、代码和不同模型的 tokenizer 都会影响 token 数。

Prompt 的 UI 预览职责见 UI 与诊断规范 (见 doc-id:10-ui-diagnostics)，段落顺序和预算稳定性必须按测试规范验证 (见 doc-id:12-testing-acceptance)。
