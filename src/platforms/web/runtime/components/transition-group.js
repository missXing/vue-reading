/* @flow */

// Provides transition support for list items.
// supports move transitions using the FLIP technique.

// Because the vdom's children update algorithm is "unstable" - i.e.
// it doesn't guarantee the relative positioning of removed elements,
// we force transition-group to update its children into two passes:
// in the first pass, we remove all nodes that need to be removed,
// triggering their leaving transition; in the second pass, we insert/move
// into the final desired state. This way in the second pass removed
// nodes will remain where they should be.

import { warn, extend } from 'core/util/index'
import { addClass, removeClass } from '../class-util'
import { transitionProps, extractTransitionData } from './transition'
import { setActiveInstance } from 'core/instance/lifecycle'

import {
  hasTransition,
  getTransitionInfo,
  transitionEndEvent,
  addTransitionClass,
  removeTransitionClass
} from '../transition-util'

const props = extend({
  tag: String,
  moveClass: String
}, transitionProps)

delete props.mode

// 会渲染成一个真实元素，默认 tag 是 span
export default {
  props,

  beforeMount () {
    const update = this._update
    this._update = (vnode, hydrating) => {
      const restoreActiveInstance = setActiveInstance(this)
      // force removing pass
      this.__patch__(
        this._vnode,
        this.kept,
        false, // hydrating
        true // removeOnly (!important, avoids unnecessary moves)
      )
      this._vnode = this.kept
      restoreActiveInstance()
      update.call(this, vnode, hydrating)
    }
  },

  render (h: Function) {
    const tag: string = this.tag || this.$vnode.data.tag || 'span'
    const map: Object = Object.create(null)
    const prevChildren: Array<VNode> = this.prevChildren = this.children // 存储上一次的子节点
    const rawChildren: Array<VNode> = this.$slots.default || [] // <transtition-group> 包裹的原始子节点
    const children: Array<VNode> = this.children = [] // 存储当前的子节点
    const transitionData: Object = extractTransitionData(this) // 从 <transtition-group> 组件上提取出来的一些渲染数据

    // 遍历 rawChidren，初始化 children
    for (let i = 0; i < rawChildren.length; i++) {
      const c: VNode = rawChildren[i]
      if (c.tag) {
        if (c.key != null && String(c.key).indexOf('__vlist') !== 0) {
          children.push(c)
          map[c.key] = c
          // 把刚刚提取的过渡数据 transitionData 添加的 vnode.data.transition 中，这点很关键，只有这样才能实现列表中单个元素的过渡动画
          ;(c.data || (c.data = {})).transition = transitionData
        } else if (process.env.NODE_ENV !== 'production') {
          const opts: ?VNodeComponentOptions = c.componentOptions
          const name: string = opts ? (opts.Ctor.options.name || opts.tag || '') : c.tag
          warn(`<transition-group> children must be keyed: <${name}>`)
        }
      }
    }

    if (prevChildren) {
      const kept: Array<VNode> = []
      const removed: Array<VNode> = []
      for (let i = 0; i < prevChildren.length; i++) {
        const c: VNode = prevChildren[i]
        // 把 transitionData 赋值到 vnode.data.transition，这个是为了当它在 enter 和 leave 的钩子函数中有过渡动画
        c.data.transition = transitionData
        // 获取到原生 DOM 的位置信息，记录到 vnode.data.pos 中
        c.data.pos = c.elm.getBoundingClientRect()
        if (map[c.key]) {
          kept.push(c)
        } else {
          // 该节点已被删除，放入 removed 中
          removed.push(c)
        }
      }
      this.kept = h(tag, null, kept)
      this.removed = removed
    }

    // 通过 h(tag, null, children) 生成渲染 vnode
    // 每次插入和删除的元素的缓动动画是可以实现的
    // 至此 剩余元素平移的过渡效果是出不来的
    return h(tag, null, children)
  },

  updated () {
    const children: Array<VNode> = this.prevChildren
    const moveClass: string = this.moveClass || ((this.name || 'v') + '-move')
    // hasMove判断子元素是否定义 move 相关样式
    if (!children.length || !this.hasMove(children[0].elm, moveClass)) {
      return
    }

    // we divide the work into three loops to avoid mixing DOM reads and writes
    // in each iteration - which helps prevent layout thrashing.
    // 子节点预处理
    children.forEach(callPendingCbs)
    children.forEach(recordPosition)
    children.forEach(applyTranslation)

    // force reflow to put everything in position
    // assign to this to avoid being removed in tree-shaking
    // $flow-disable-line
    // 通过 document.body.offsetHeight 强制触发浏览器重绘
    this._reflow = document.body.offsetHeight

    // 遍历子元素实现 move 过渡
    children.forEach((c: VNode) => {
      if (c.data.moved) {
        const el: any = c.elm
        const s: any = el.style
        addTransitionClass(el, moveClass)
        // 把子节点的 style.transform 设置为空，由于我们前面把这些节点偏移到之前的旧位置，
        // 所以它就会从旧位置按照 1s 的缓动时间过渡偏移到它的当前目标位置，这样就实现了 move 的过渡动画
        s.transform = s.WebkitTransform = s.transitionDuration = ''
        // 监听 transitionEndEvent 过渡结束的事件，做一些清理的操作
        el.addEventListener(transitionEndEvent, el._moveCb = function cb (e) {
          if (e && e.target !== el) {
            return
          }
          if (!e || /transform$/.test(e.propertyName)) {
            el.removeEventListener(transitionEndEvent, cb)
            el._moveCb = null
            removeTransitionClass(el, moveClass)
          }
        })
      }
    })
  },

  methods: {
    hasMove (el: any, moveClass: string): boolean {
      /* istanbul ignore if */
      if (!hasTransition) {
        return false
      }
      /* istanbul ignore if */
      if (this._hasMove) {
        return this._hasMove
      }
      // Detect whether an element with the move class applied has
      // CSS transitions. Since the element may be inside an entering
      // transition at this very moment, we make a clone of it and remove
      // all other transition classes applied to ensure only the move class
      // is applied.
      // 克隆一个 DOM 节点，然后为了避免影响，移除它的所有其他的过渡 Class
      const clone: HTMLElement = el.cloneNode()
      if (el._transitionClasses) {
        el._transitionClasses.forEach((cls: string) => { removeClass(clone, cls) })
      }
      addClass(clone, moveClass)
      clone.style.display = 'none'
      // 添加到组件根节点上
      this.$el.appendChild(clone)
      // 获取它的一些缓动相关的信息
      const info: Object = getTransitionInfo(clone)
      // 从组件根节点上删除这个克隆节点
      this.$el.removeChild(clone)
      // 通过判断 info.hasTransform 来判断 hasMove
      return (this._hasMove = info.hasTransform)
    }
  }
}

// 在前一个过渡动画没执行完又再次执行到该方法的时候，会提前执行 _moveCb 和 _enterCb
function callPendingCbs (c: VNode) {
  /* istanbul ignore if */
  if (c.elm._moveCb) {
    c.elm._moveCb()
  }
  /* istanbul ignore if */
  if (c.elm._enterCb) {
    c.elm._enterCb()
  }
}

// 记录节点的新位置
function recordPosition (c: VNode) {
  c.data.newPos = c.elm.getBoundingClientRect()
}

// 先计算节点新位置和旧位置的差值，如果差值不为 0，则说明这些节点是需要移动的，
// 所以记录 vnode.data.moved 为 true，并且通过设置 transform 把需要移动的节点的位置又偏移到之前的旧位置，
// 目的是为了做 move 缓动做准备
function applyTranslation (c: VNode) {
  const oldPos = c.data.pos
  const newPos = c.data.newPos
  const dx = oldPos.left - newPos.left
  const dy = oldPos.top - newPos.top
  if (dx || dy) {
    c.data.moved = true
    const s = c.elm.style
    s.transform = s.WebkitTransform = `translate(${dx}px,${dy}px)`
    s.transitionDuration = '0s'
  }
}
