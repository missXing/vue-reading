/* @flow */

import type Watcher from './watcher'
import { remove } from '../util/index'
import config from '../config'

let uid = 0

/**
 * A dep is an observable that can have multiple
 * directives subscribing to it.
 */
// Dep 实际上就是对 Watcher 的一种管理
export default class Dep {
  static target: ?Watcher; // 全局唯一 Watcher
  id: number;
  subs: Array<Watcher>; // 订阅这个数据变化的Watcher 的数组

  constructor () {
    this.id = uid++
    this.subs = []
  }

  addSub (sub: Watcher) {
    this.subs.push(sub)
  }

  removeSub (sub: Watcher) {
    remove(this.subs, sub)
  }

  depend () {
    if (Dep.target) {
      // addDep 在watcher中定义
      Dep.target.addDep(this)
    }
  }

  notify () {
    // stabilize the subscriber list first
    const subs = this.subs.slice()
    if (process.env.NODE_ENV !== 'production' && !config.async) {
      // subs aren't sorted in scheduler if not running async
      // we need to sort them now to make sure they fire in correct
      // order
      subs.sort((a, b) => a.id - b.id)
    }
    // 通知所有的订阅者
    // 遍历所有的 subs，也就是 Watcher 的实例数组，然后调用每一个 watcher 的 update 方法
    for (let i = 0, l = subs.length; i < l; i++) {
      subs[i].update()
    }
  }
}

// The current target watcher being evaluated.
// This is globally unique because only one watcher
// can be evaluated at a time.
Dep.target = null
const targetStack = []

export function pushTarget (target: ?Watcher) {
  // 把 target 赋值为当前的渲染 watcher 并压栈（为了恢复用）
  targetStack.push(target)
  Dep.target = target
}

// 把 Dep.target 恢复成上一个状态
export function popTarget () {
  targetStack.pop()
  Dep.target = targetStack[targetStack.length - 1]
}
