/* @flow */

import { extend, warn, isObject } from 'core/util/index'

/**
 * Runtime helper for rendering <slot>
 */
export function renderSlot (
  name: string, // 插槽名称 slotName
  fallbackRender: ?((() => Array<VNode>) | Array<VNode>), // 插槽的默认内容生成的 vnode 数组
  props: ?Object,
  bindObject: ?Object
): ?Array<VNode> {
  const scopedSlotFn = this.$scopedSlots[name]
  let nodes
  if (scopedSlotFn) {
    // scoped slot
    props = props || {}
    if (bindObject) {
      if (process.env.NODE_ENV !== 'production' && !isObject(bindObject)) {
        warn('slot v-bind without argument expects an Object', this)
      }
      props = extend(extend({}, bindObject), props)
    }
    nodes =
      scopedSlotFn(props) ||
      (typeof fallbackRender === 'function' ? fallbackRender() : fallbackRender)
  } else {
    nodes =
    // 根据插槽名称获取到对应的 vnode 数组了，这个数组里的 vnode 都是在父组件创建的，这样就实现了在父组件替换子组件插槽的内容了
    // this.$slots中的内容是 子组件在initRender（src/core/instance/render.js）时
    // 调用resolveSlots（src/core/instance/render-helpers/resolve-slots.js） 中添加
      this.$slots[name] ||
      (typeof fallbackRender === 'function' ? fallbackRender() : fallbackRender)
  }

  const target = props && props.slot
  if (target) {
    return this.$createElement('template', { slot: target }, nodes)
  } else {
    return nodes
  }
}
