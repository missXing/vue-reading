/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError,
  invokeWithErrorHandling,
  noop
} from '../util/index'

import { traverse } from './traverse'
import { queueWatcher } from './scheduler'
import Dep, { pushTarget, popTarget } from './dep'

import type { SimpleSet } from '../util/index'
import { set } from '.'

let uid = 0

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component;
  expression: string;
  cb: Function;
  id: number;
  deep: boolean;
  user: boolean;
  lazy: boolean;
  sync: boolean;
  dirty: boolean;
  active: boolean;
  deps: Array<Dep>; //  Watcher 实例持有的 Dep 实例的数组
  newDeps: Array<Dep>; //  Watcher 实例持有的 Dep 实例的数组
  depIds: SimpleSet; // this.deps  的 id
  newDepIds: SimpleSet; // this.newDeps 的 id
  before: ?Function;
  getter: Function;
  value: any;

  constructor (
    vm: Component,
    expOrFn: string | Function,
    cb: Function,
    options?: ?Object,
    isRenderWatcher?: boolean
  ) {
    this.vm = vm
    if (isRenderWatcher) {
      // 把当前 watcher 的实例赋值给 vm._watcher
      // vm._watcher 是专门用来监听 vm 上数据变化然后重新渲染的，所以它是一个渲染相关的 watcher
      // 因此在 callUpdatedHooks 函数中，只有 vm._watcher 的回调执行完毕后，才会执行 updated 钩子函数
      vm._watcher = this
    }
    // 把当前 wathcer 实例 push 到 vm._watchers 中
    vm._watchers.push(this)
    // options
    if (options) {
      this.deep = !!options.deep
      this.user = !!options.user
      this.lazy = !!options.lazy
      this.sync = !!options.sync
      this.before = options.before
    } else {
      this.deep = this.user = this.lazy = this.sync = false
    }
    this.cb = cb
    this.id = ++uid // uid for batching
    this.active = true
    this.dirty = this.lazy // for lazy watchers
    this.deps = []
    this.newDeps = []
    this.depIds = new Set()
    this.newDepIds = new Set()
    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''
    // parse expression for getter
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      this.getter = parsePath(expOrFn)
      if (!this.getter) {
        this.getter = noop
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    this.value = this.lazy
      ? undefined // 计算属性走这里
      : this.get()
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   */
  // 和依赖收集相关的原型方法
  get () {
    // 把 this 赋值为当前的渲 染 watcher 并压栈（为了恢复用）
    pushTarget(this)
    let value
    const vm = this.vm
    try {
      // this.getter 对应就是 updateComponent 函数
      // 这实际上就是在执行 vm._update(vm._render(), hydrating)
      // 它会先执行 vm._render() 方法，这个方法会生成 渲染 VNode，
      // 并且在这个过程中会对 vm 上的数据访问，这个时候就触发了数据对象的 getter。
      // 那么每个对象值的 getter 都持有一个 dep，在触发 getter 的时候会调用 dep.depend() 方法，也就会执行 Dep.target.addDep(this)。
      // computed触发来到这里 会computed的依赖 （数据依赖） 依赖发生变化的时候会触发computed的update
      value = this.getter.call(vm, vm)
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      // 递归去访问 value，触发它所有子项的 getter
      if (this.deep) {
        traverse(value)
      }
      popTarget()
      // 依赖清空(将newdeps赋值给deps，清空newdeps,其实清空的是没有用的依赖)
      this.cleanupDeps()
    }
    return value
  }

  /**
   * Add a dependency to this directive.
   */
  // 和依赖收集相关的原型方法
  addDep (dep: Dep) {
    const id = dep.id
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      if (!this.depIds.has(id)) { // 保证同一数据不会被添加多次
        // 执行 dep.addSub(this)，那么就会执行 this.subs.push(sub)
        // 把当前的 watcher 订阅到这个数据持有的 dep 的 subs 中，这个目的是为后续数据变化时候能通知到哪些 subs 做准备
        dep.addSub(this)
      }
    }
  }

  /**
   * Clean up for dependency collection.
   */
  // 和依赖收集相关的原型方法 依赖清空
  cleanupDeps () {
    let i = this.deps.length
    // 首先遍历 deps，移除对 dep.subs 数组中 Wathcer 的订阅，
    while (i--) {
      const dep = this.deps[i]
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this)
      }
    }
    // 然后把 newDepIds 和 depIds 交换，newDeps 和 deps 交换，并把 newDepIds 和 newDeps 清空。
    // 为啥不先把newDepIds赋值给depIds，再清空newDepIds？ 为啥要交换？
    this.depIds = this.newDepIds
    this.newDepIds = new set([])
    this.deps = this.newDeps
    this.newDeps = new Array()
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   */
  update () {
    /* istanbul ignore else */
    if (this.lazy) {
      this.dirty = true
    } else if (this.sync) {
      // 同步watcher
      this.run()
    } else {
      queueWatcher(this)
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   */
  run () {
    if (this.active) {
      // 通过 this.get() 得到它当前的值
      // 对于渲染 watcher 而言，它在执行 this.get() 方法求值的时候，会执行 getter 方法
      // updateComponent = () => {
      //   vm._update(vm._render(), hydrating)
      // }
      // 这就是当我们去修改组件相关的响应式数据的时候，会触发组件重新渲染的原因，接着就会重新执行 patch 的过程，但它和首次渲染有所不同
      const value = this.get()
      // 判断如果满足新旧值不等、新值是对象类型、deep 模式任何一个条件，则执行 watcher 的回调
      if (
        value !== this.value ||
        // Deep watchers and watchers on Object/Arrays should fire even
        // when the value is the same, because the value may
        // have mutated.
        isObject(value) ||
        this.deep
      ) {
        // set new value
        const oldValue = this.value
        this.value = value
        if (this.user) {
          const info = `callback for watcher "${this.expression}"`
          invokeWithErrorHandling(this.cb, this.vm, [value, oldValue], this.vm, info)
        } else {
          // 执行 watcher 的回调, 回调函数执行的时候会把第一个和第二个参数传入新值 value 和旧值 oldValue
          // 这就是当我们添加自定义 watcher 的时候能在回调函数的参数中拿到新旧值的原因
          this.cb.call(this.vm, value, oldValue)
        }
      }
    }
  }

  /**
   * Evaluate the value of the watcher.
   * This only gets called for lazy watchers.
   */
  evaluate () {
    // 真正访问到computed的getter
    this.value = this.get()
    this.dirty = false
  }

  /**
   * Depend on all deps collected by this watcher.
   */
  depend () {
    // deps中是computed watcher 所依赖的响应式数据
    let i = this.deps.length
    while (i--) {
      this.deps[i].depend()
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   */
  teardown () {
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this)
      }
      let i = this.deps.length
      while (i--) {
        this.deps[i].removeSub(this)
      }
      this.active = false
    }
  }
}
