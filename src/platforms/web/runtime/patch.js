/* @flow */

import * as nodeOps from 'web/runtime/node-ops'
import { createPatchFunction } from 'core/vdom/patch'
import baseModules from 'core/vdom/modules/index'
import platformModules from 'web/runtime/modules/index'

// the directive module should be applied last, after all
// built-in modules have been applied.
const modules = platformModules.concat(baseModules)

// patch 是平台相关的，在 Web 和 Weex 环境，它们把虚拟 DOM 映射到 “平台 DOM” 的方法是不同的，
// 并且对 “DOM” 包括的属性模块创建和更新也不尽相同。因此每个平台都有各自的 nodeOps 和 modules，
// 它们的代码需要托管在 src/platforms 这个大目录下
// 而不同平台的 patch 的主要逻辑部分是相同的，所以这部分公共的部分托管在 core 这个大目录下
// nodeOps 表示对 “平台 DOM” 的一些操作方法
// modules 表示平台的一些模块
// 它们会在整个 patch 过程的不同阶段执行相应的钩子函数
export const patch: Function = createPatchFunction({ nodeOps, modules })
