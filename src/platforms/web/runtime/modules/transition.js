/* @flow */

import { inBrowser, isIE9, warn } from 'core/util/index'
import { mergeVNodeHook } from 'core/vdom/helpers/index'
import { activeInstance } from 'core/instance/lifecycle'

import {
  once,
  isDef,
  isUndef,
  isObject,
  toNumber
} from 'shared/util'

import {
  nextFrame,
  resolveTransition,
  whenTransitionEnds,
  addTransitionClass,
  removeTransitionClass
} from '../transition-util'

// 整个 entering 过程的实现是 enter 函数
export function enter (vnode: VNodeWithData, toggleDisplay: ?() => void) {
  const el: any = vnode.elm

  // call leave callback now
  if (isDef(el._leaveCb)) {
    el._leaveCb.cancelled = true
    el._leaveCb()
  }

  // 解析出过渡相关的一些数据
  // 通过 autoCssTransition 处理 name 属性，生成一个用来描述各个阶段的 Class 名称的对象，扩展到 def 中并返回给 data
  const data = resolveTransition(vnode.data.transition)
  if (isUndef(data)) {
    return
  }

  /* istanbul ignore if */
  if (isDef(el._enterCb) || el.nodeType !== 1) {
    return
  }

  const {
    css,
    type,
    enterClass,
    enterToClass,
    enterActiveClass,
    appearClass,
    appearToClass,
    appearActiveClass,
    beforeEnter,
    enter,
    afterEnter,
    enterCancelled,
    beforeAppear,
    appear,
    afterAppear,
    appearCancelled,
    duration
  } = data

  // activeInstance will always be the <transition> component managing this
  // transition. One edge case to check is when the <transition> is placed
  // as the root node of a child component. In that case we need to check
  // <transition>'s parent for appear check.
  // 处理边界情况
  // 当 <transition> 作为子组件的根节点，那么我们需要检查它的父组件作为 appear 的检查
  let context = activeInstance
  let transitionNode = activeInstance.$vnode
  while (transitionNode && transitionNode.parent) {
    context = transitionNode.context
    transitionNode = transitionNode.parent
  }

  // isAppear 表示当前上下文实例还没有 mounted， 第一次出现的时机
  const isAppear = !context._isMounted || !vnode.isRootInsert

  // 如果是第一次并且 <transition> 组件没有配置 appear 的话，直接返回
  if (isAppear && !appear && appear !== '') {
    return
  }

  // 定义过渡类名、钩子函数和其它配置
  // startClass 定义进入过渡的开始状态，在元素被插入时生效，在下一个帧移除
  const startClass = isAppear && appearClass
    ? appearClass
    : enterClass
  // activeClass定义过渡的状态，在元素整个过渡过程中作用，在元素被插入时生效，在 transition/animation 完成之后移除
  const activeClass = isAppear && appearActiveClass
    ? appearActiveClass
    : enterActiveClass
  // toClass 定义进入过渡的结束状态，在元素被插入一帧后生效 (与此同时 startClass 被删除)，在 <transition>/animation 完成之后移除
  const toClass = isAppear && appearToClass
    ? appearToClass
    : enterToClass

  // beforeEnterHook 是过渡开始前执行的钩子函数
  const beforeEnterHook = isAppear
    ? (beforeAppear || beforeEnter)
    : beforeEnter
  // enterHook 是在元素插入后或者是 v-show 显示切换后执行的钩子函数
  const enterHook = isAppear
    ? (typeof appear === 'function' ? appear : enter)
    : enter
  // afterEnterHook 是在过渡动画执行完后的钩子函数
  const afterEnterHook = isAppear
    ? (afterAppear || afterEnter)
    : afterEnter
  const enterCancelledHook = isAppear
    ? (appearCancelled || enterCancelled)
    : enterCancelled

  // explicitEnterDuration 表示 enter 动画执行的时间
  const explicitEnterDuration: any = toNumber(
    isObject(duration)
      ? duration.enter
      : duration
  )

  if (process.env.NODE_ENV !== 'production' && explicitEnterDuration != null) {
    checkDuration(explicitEnterDuration, 'enter', vnode)
  }

  // expectsCSS 表示过渡动画是受 CSS 的影响
  const expectsCSS = css !== false && !isIE9
  const userWantsControl = getHookArgumentsLength(enterHook)

  // cb 定义的是过渡完成执行的回调函数
  const cb = el._enterCb = once(() => {
    if (expectsCSS) {
      removeTransitionClass(el, toClass)
      removeTransitionClass(el, activeClass)
    }
    if (cb.cancelled) {
      if (expectsCSS) {
        removeTransitionClass(el, startClass)
      }
      enterCancelledHook && enterCancelledHook(el)
    } else {
      afterEnterHook && afterEnterHook(el)
    }
    el._enterCb = null
  })

  // 合并 insert 钩子函数
  if (!vnode.data.show) {
    // remove pending leave element on enter by injecting an insert hook
    // 把 hook 函数合并到 def.data.hook[hookey] 中，生成新的 invoker
    // 在 <transition> 过程中合并的 insert 钩子函数，就会合并到组件 vnode 的 insert 钩子函数中，
    // 这样当组件插入后，就会执行我们定义的 enterHook 了
    mergeVNodeHook(vnode, 'insert', () => {
      const parent = el.parentNode
      const pendingNode = parent && parent._pending && parent._pending[vnode.key]
      if (pendingNode &&
        pendingNode.tag === vnode.tag &&
        pendingNode.elm._leaveCb
      ) {
        pendingNode.elm._leaveCb()
      }
      enterHook && enterHook(el, cb)
    })
  }

  // start enter transition
  // 开始执行过渡动画
  beforeEnterHook && beforeEnterHook(el)
  // expectsCSS如果为 true 则表明希望用 CSS 来控制动画
  if (expectsCSS) {
    // 给当前 DOM 元素 el 添加样式 cls （startClass、activeClass）
    addTransitionClass(el, startClass)
    addTransitionClass(el, activeClass)
    // 一个简单的 requestAnimationFrame 的实现
    // 它的参数 fn 会在下一帧执行
    nextFrame(() => {
      removeTransitionClass(el, startClass)
      // 判断此时过渡没有被取消
      if (!cb.cancelled) {
        addTransitionClass(el, toClass)
        // 判断 !userWantsControl，也就是用户不通过 enterHook 钩子函数控制动画，
        // 这时候如果用户指定了 explicitEnterDuration，则延时这个时间执行 cb，
        // 否则通过 whenTransitionEnds(el, type, cb) 决定执行 cb 的时机
        if (!userWantsControl) {
          if (isValidDuration(explicitEnterDuration)) {
            setTimeout(cb, explicitEnterDuration)
          } else {
            // 利用了过渡动画的结束事件来决定 cb 函数的执行
            whenTransitionEnds(el, type, cb)
          }
        }
      }
    })
  }

  if (vnode.data.show) {
    toggleDisplay && toggleDisplay()
    enterHook && enterHook(el, cb)
  }

  if (!expectsCSS && !userWantsControl) {
    cb()
  }
}

// leave 的实现，和 enter 的实现几乎是一个镜像过程，不同的是从 data 中解析出来的是 leave 相关的样式类名和钩子函数。
// 还有一点不同是可以配置 delayLeave，它是一个函数，可以延时执行 leave 的相关过渡动画，
// 在 leave 动画执行完后，它会执行 rm 函数把节点从 DOM 中真正做移除
export function leave (vnode: VNodeWithData, rm: Function) {
  const el: any = vnode.elm

  // call enter callback now
  if (isDef(el._enterCb)) {
    el._enterCb.cancelled = true
    el._enterCb()
  }

  const data = resolveTransition(vnode.data.transition)
  if (isUndef(data) || el.nodeType !== 1) {
    return rm()
  }

  /* istanbul ignore if */
  if (isDef(el._leaveCb)) {
    return
  }

  const {
    css,
    type,
    leaveClass,
    leaveToClass,
    leaveActiveClass,
    beforeLeave,
    leave,
    afterLeave,
    leaveCancelled,
    delayLeave,
    duration
  } = data

  const expectsCSS = css !== false && !isIE9
  const userWantsControl = getHookArgumentsLength(leave)

  const explicitLeaveDuration: any = toNumber(
    isObject(duration)
      ? duration.leave
      : duration
  )

  if (process.env.NODE_ENV !== 'production' && isDef(explicitLeaveDuration)) {
    checkDuration(explicitLeaveDuration, 'leave', vnode)
  }

  const cb = el._leaveCb = once(() => {
    if (el.parentNode && el.parentNode._pending) {
      el.parentNode._pending[vnode.key] = null
    }
    if (expectsCSS) {
      removeTransitionClass(el, leaveToClass)
      removeTransitionClass(el, leaveActiveClass)
    }
    if (cb.cancelled) {
      if (expectsCSS) {
        removeTransitionClass(el, leaveClass)
      }
      leaveCancelled && leaveCancelled(el)
    } else {
      rm()
      afterLeave && afterLeave(el)
    }
    el._leaveCb = null
  })

  // 延时执行 leave 的相关过渡动画
  if (delayLeave) {
    delayLeave(performLeave)
  } else {
    performLeave()
  }

  function performLeave () {
    // the delayed leave may have already been cancelled
    if (cb.cancelled) {
      return
    }
    // record leaving element
    if (!vnode.data.show && el.parentNode) {
      (el.parentNode._pending || (el.parentNode._pending = {}))[(vnode.key: any)] = vnode
    }
    beforeLeave && beforeLeave(el)
    if (expectsCSS) {
      addTransitionClass(el, leaveClass)
      addTransitionClass(el, leaveActiveClass)
      nextFrame(() => {
        removeTransitionClass(el, leaveClass)
        if (!cb.cancelled) {
          addTransitionClass(el, leaveToClass)
          if (!userWantsControl) {
            if (isValidDuration(explicitLeaveDuration)) {
              setTimeout(cb, explicitLeaveDuration)
            } else {
              whenTransitionEnds(el, type, cb)
            }
          }
        }
      })
    }
    leave && leave(el, cb)
    if (!expectsCSS && !userWantsControl) {
      cb()
    }
  }
}

// only used in dev mode
function checkDuration (val, name, vnode) {
  if (typeof val !== 'number') {
    warn(
      `<transition> explicit ${name} duration is not a valid number - ` +
      `got ${JSON.stringify(val)}.`,
      vnode.context
    )
  } else if (isNaN(val)) {
    warn(
      `<transition> explicit ${name} duration is NaN - ` +
      'the duration expression might be incorrect.',
      vnode.context
    )
  }
}

function isValidDuration (val) {
  return typeof val === 'number' && !isNaN(val)
}

/**
 * Normalize a transition hook's argument length. The hook may be:
 * - a merged hook (invoker) with the original in .fns
 * - a wrapped component method (check ._length)
 * - a plain function (.length)
 */
function getHookArgumentsLength (fn: Function): boolean {
  if (isUndef(fn)) {
    return false
  }
  const invokerFns = fn.fns
  if (isDef(invokerFns)) {
    // invoker
    return getHookArgumentsLength(
      Array.isArray(invokerFns)
        ? invokerFns[0]
        : invokerFns
    )
  } else {
    return (fn._length || fn.length) > 1
  }
}

function _enter (_: any, vnode: VNodeWithData) {
  if (vnode.data.show !== true) {
    enter(vnode)
  }
}

// 对于过渡的实现，它只接收了 create 和 activate 2 个钩子函数
// 过渡动画提供了 2 个时机，一个是 create 和 activate 的时候提供了 entering 进入动画，
// 一个是 remove 的时候提供了 leaving 离开动画
// entering 主要发生在组件插入后，而 leaving 主要发生在组件销毁前
export default inBrowser ? {
  create: _enter,
  activate: _enter,
  remove (vnode: VNode, rm: Function) {
    /* istanbul ignore else */
    if (vnode.data.show !== true) {
      leave(vnode, rm)
    } else {
      rm()
    }
  }
} : {}
