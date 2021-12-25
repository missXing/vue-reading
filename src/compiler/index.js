/* @flow */

import { parse } from './parser/index'
import { optimize } from './optimizer'
import { generate } from './codegen/index'
import { createCompilerCreator } from './create-compiler'

// `createCompilerCreator` allows creating compilers that use alternative
// parser/optimizer/codegen, e.g the SSR optimizing compiler.
// Here we just export a default compiler using the default parts.
// 真正的编译过程都在这个 baseCompile 函数里执行
export const createCompiler = createCompilerCreator(function baseCompile (
  template: string,
  options: CompilerOptions
): CompiledResult {
  // 编译的入口函数
  // 解析模板字符串生成 AST
  const ast = parse(template.trim(), options)
  if (options.optimize !== false) {
    // 优化语法树 把一些 AST 节点优化成静态节点
    // markStatic(root) 标记静态节点 ，markStaticRoots(root, false) 标记静态根
    optimize(ast, options)
  }
  // 把优化后的 AST 树转换成可执行的代码
  const code = generate(ast, options)
  return {
    ast,
    render: code.render,
    staticRenderFns: code.staticRenderFns
  }
})
