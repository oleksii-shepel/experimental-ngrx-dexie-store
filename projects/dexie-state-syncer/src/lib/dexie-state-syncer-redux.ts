import { Observable, Observer, Subscription } from "rxjs";
import { Semaphore } from './dexie-state-syncer-semaphore';

// src/types/actions.ts
function isAction(action: any): boolean {
  return isPlainObject(action) && "type" in action && typeof action.type === "string";
}

function isPlainObject(obj: any): boolean {
  if (typeof obj !== "object" || obj === null)
    return false;

  let proto = obj;
  while (Object.getPrototypeOf(proto) !== null) {
    proto = Object.getPrototypeOf(proto);
  }

  return Object.getPrototypeOf(obj) === proto;
}

// src/utils/actionTypes.ts
const randomString = (): string => Math.random().toString(36).substring(7).split("").join(".");

const ActionTypes = {
  INIT: `@@redux/INIT${/* @__PURE__ */ randomString()}`,
  REPLACE: `@@redux/REPLACE${/* @__PURE__ */ randomString()}`,
  PROBE_UNKNOWN_ACTION: (): string => `@@redux/PROBE_UNKNOWN_ACTION${randomString()}`
};

const actionTypes_default = ActionTypes;

// src/utils/kindOf.ts
function kindOf(val: any): string {
  if (val === undefined)
    return "undefined";
  if (val === null)
    return "null";

  const type = typeof val;
  switch (type) {
    case "boolean":
    case "string":
    case "number":
    case "symbol":
    case "function": {
      return type;
    }
  }

  if (Array.isArray(val))
    return "array";

  if (isDate(val))
    return "date";

  if (isError(val))
    return "error";

  const constructorName = ctorName(val);
  switch (constructorName) {
    case "Symbol":
    case "Promise":
    case "WeakMap":
    case "WeakSet":
    case "Map":
    case "Set":
      return constructorName;
  }

  return Object.prototype.toString.call(val).slice(8, -1).toLowerCase().replace(/\s/g, "");
}

function ctorName(val: any): string {
  return typeof val.constructor === "function" ? val.constructor.name : null;
}

function isError(val: any): boolean {
  return val instanceof Error || typeof val.message === "string" && val.constructor && typeof val.constructor.stackTraceLimit === "number";
}

function isDate(val: any): boolean {
  if (val instanceof Date)
    return true;

  return typeof val.toDateString === "function" && typeof val.getDate === "function" && typeof val.setDate === "function";
}

// src/types/middleware.ts
export function createThunkMiddleware(extraArgument?: any) {
  const middleware: Function = ({ dispatch, getState }: any) => (next: any) => (action: any) => {
    if (typeof action === "function") {
      return action(dispatch, getState, extraArgument);
    }
    return next(action);
  };
  return middleware;
}

// src/createStore.ts
function createStore(reducer: Function, preloadedState?: any, enhancer?: Function): any {
  if (typeof reducer !== "function") {
    throw new Error(`Expected the root reducer to be a function. Instead, received: '${kindOf(reducer)}'`);
  }

  if ((typeof preloadedState === "function" && typeof enhancer === "function") || (typeof enhancer === "function" && typeof arguments[3] === "function")) {
    throw new Error("It looks like you are passing several store enhancers to createStore(). This is not supported. Instead, compose them together to a single function. See https://redux.js.org/tutorials/fundamentals/part-4-store#creating-a-store-with-enhancers for an example.");
  }

  if (typeof preloadedState === "function" && typeof enhancer === "undefined") {
    enhancer = preloadedState;
    preloadedState = undefined;
  }

  if (typeof enhancer !== "undefined") {
    if (typeof enhancer !== "function") {
      throw new Error(`Expected the enhancer to be a function. Instead, received: '${kindOf(enhancer)}'`);
    }
    return enhancer(createStore)(reducer, preloadedState);
  }


  class StoreObservable extends Observable<any> implements Observer<any> {
    currentReducer: any;
    currentState: any;
    observer: Observer<any> | undefined;
    isDispatching: boolean;
    isObserverInitialized: boolean;
    actionQueue: any[];

    constructor(reducer: any, preloadedState: any) {
      super((observer: Observer<any>) => {
        this.observer = observer;
        this.isObserverInitialized = true;

        // Process queued actions
        while (this.actionQueue.length > 0) {
          const action = this.actionQueue.shift();
          this.dispatch(action);
        }
      });

      this.currentReducer = reducer;
      this.currentState = preloadedState;
      this.isObserverInitialized = false;
      this.isDispatching = false;
      this.actionQueue = [];
    }

    getState(): any {
      return this.currentState;
    }

    override subscribe(next?: any, error?: any, complete?: any): Subscription {
      if (typeof next === 'function') {
        return super.subscribe(next, error, complete);
      } else {
        return super.subscribe(next as Partial<Observer<any>>);
      }
    }

    dispatch(action: any): any {
      if (!isPlainObject(action)) {
        throw new Error(`Actions must be plain objects. Instead, the actual type was: '${kindOf(action)}'. You may need to add middleware to your store setup to handle dispatching other values, such as 'redux-thunk' to handle dispatching functions. See https://redux.js.org/tutorials/fundamentals/part-4-store#middleware and https://redux.js.org/tutorials/fundamentals/part-6-async-logic#using-the-redux-thunk-middleware for examples.`);
      }
      if (typeof action.type === "undefined") {
        throw new Error('Actions may not have an undefined "type" property. You may have misspelled an action type string constant.');
      }
      if (typeof action.type !== "string") {
        throw new Error(`Action "type" property must be a string. Instead, the actual type was: '${kindOf(action.type)}'. Value was: '${action.type}' (stringified)`);
      }
      if (this.isDispatching) {
        throw new Error("Reducers may not dispatch actions.");
      }
      if (this.isObserverInitialized) {
        this.processAction(action);
      } else {
        this.actionQueue.push(action);
      }
      return action;
    }

    processAction(action: any): void {
      try {
        this.isDispatching = true;
        this.currentState = this.currentReducer(this.currentState, action);
        this.next(this.currentState);
      } finally {
        this.isDispatching = false;
      }
    }

    replaceReducer(nextReducer: Function): void {
      if (typeof nextReducer !== "function") {
        throw new Error(`Expected the nextReducer to be a function. Instead, received: '${kindOf(nextReducer)}`);
      }
      this.currentReducer = nextReducer;
      this.dispatch({
        type: actionTypes_default.REPLACE
      });
    }

    next(value: any): void {
      if (this.observer) {
        this.observer.next(value);
      }
    }

    error(err: any): void {
      if (this.observer) {
        this.observer.error(err);
      }
    }

    complete(): void {
      if (this.observer) {
        this.observer.complete();
      }
    }
  }

  let store = new StoreObservable(reducer, preloadedState);

  store.dispatch({
    type: actionTypes_default.INIT
  });

  return store;
}

// src/combineReducers.ts
function assertReducerShape(reducers: any): void {
  const reducerKeys = Object.keys(reducers);

  for (const key of reducerKeys) {
    const reducer = reducers[key];
    const initialState = reducer(undefined, {
      type: actionTypes_default.INIT
    });

    if (typeof initialState === "undefined") {
      throw new Error(`The slice reducer for key "${key}" returned undefined during initialization. If the state passed to the reducer is undefined, you must explicitly return the initial state. The initial state may not be undefined. If you don't want to set a value for this reducer, you can use null instead of undefined.`);
    }

    if (typeof reducer(undefined, {
      type: actionTypes_default.PROBE_UNKNOWN_ACTION()
    }) === "undefined") {
      throw new Error(`The slice reducer for key "${key}" returned undefined when probed with a random type. Don't try to handle '${actionTypes_default.INIT}' or other actions in "redux/*" namespace. They are considered private. Instead, you must return the current state for any unknown actions, unless it is undefined, in which case you must return the initial state, regardless of the action type. The initial state may not be undefined, but can be null.`);
    }
  }
}

function combineReducers(reducers: any): Function {
  const reducerKeys = Object.keys(reducers);
  const finalReducers: any = {};

  for (const key of reducerKeys) {
    if (typeof reducers[key] === "function") {
      finalReducers[key] = reducers[key];
    }
  }

  const finalReducerKeys = Object.keys(finalReducers);

  return function combination(state = {} as any, action: any): any {
    assertReducerShape(finalReducers);

    const nextState: any = {};
    let hasChanged = false;

    for (const key of finalReducerKeys) {
      const reducer = finalReducers[key];
      const previousStateForKey = state[key];
      const nextStateForKey = reducer(previousStateForKey, action);

      if (typeof nextStateForKey === "undefined") {
        const actionType = action && action.type;
        throw new Error(`When called with an action of type ${actionType ? `"${String(actionType)}"` : "(unknown type)"}, the slice reducer for key "${key}" returned undefined. To ignore an action, you must explicitly return the previous state. If you want this reducer to hold no value, you can return null instead of undefined.`);
      }

      nextState[key] = nextStateForKey;
      hasChanged = hasChanged || nextStateForKey !== previousStateForKey;

      if (hasChanged) {
        break;
      }
    }

    if (!hasChanged && finalReducerKeys.length === Object.keys(state).length) {
      return state;
    }

    return nextState;
  };
}

// src/bindActionCreators.ts
function bindActionCreator(actionCreator: Function, dispatch: Function): Function {
  return function(this: any, ...args: any[]): any {
    return dispatch(actionCreator.apply(this, args));
  };
}

function bindActionCreators(actionCreators: any, dispatch: Function): any {
  if (typeof actionCreators === "function") {
    return bindActionCreator(actionCreators, dispatch);
  }

  if (typeof actionCreators !== "object" || actionCreators === null) {
    throw new Error(`bindActionCreators expected an object or a function, but instead received: '${kindOf(actionCreators)}'. Did you write "import ActionCreators from" instead of "import * as ActionCreators from"?`);
  }

  const keys = Object.keys(actionCreators);
  const numKeys = keys.length;

  if (numKeys === 1) {
    const actionCreator = actionCreators[keys[0]];

    if (typeof actionCreator === "function") {
      return bindActionCreator(actionCreator, dispatch);
    }
  }

  for (let i = 0; i < numKeys; i++) {
    const key = keys[i];
    const actionCreator = actionCreators[key];

    if (typeof actionCreator === "function") {
      actionCreators[key] = bindActionCreator(actionCreator, dispatch);
    }
  }

  return actionCreators;
}

// src/compose.ts
function compose(...funcs: Function[]): Function {
  if (funcs.length === 0) {
    return (arg: any): any => arg;
  }

  if (funcs.length === 1) {
    return funcs[0];
  }

  return funcs.reduce((a, b) => (...args: any[]) => a(b(...args)));
}

export class Middleware {
  dispatch: (action: any, ...extraArgs: any[]) => any;
  getState: () => any;

  constructor(dispatch: (action: any, ...extraArgs: any[]) => any, getState: () => any) {
    this.dispatch = dispatch;
    this.getState = getState;
  }

  handle(action: any, next: (action: any) => void): void {
    return next(action);
  }
}

function composeMiddleware(...middlewares: Middleware[]): (next: any) => (action: any) => any {
  return (next: any) => {
    const dispatch = (action: any) => {
      let currentIndex = middlewares.length - 1;
      const nextMiddleware = () => {
        currentIndex--;
        if (currentIndex >= 0) {
          middlewares[currentIndex].handle(action, nextMiddleware);
        } else {
          next(action);
        }
      };
      nextMiddleware();
    };
    return dispatch;
  };
}

// src/applyMiddleware.ts
function applyMiddleware(...middlewares: Middleware[]): Function {
  return (createStore: any) => (reducer: any, preloadedState: any) => {
    const store = createStore(reducer, preloadedState);

    const chain = middlewares.map((middleware) => {
      middleware.handle.bind(middleware);
      return middleware;
    });

    store.dispatch = composeMiddleware(...chain)(store.dispatch.bind(store));
    return store;
  };
}

export {
  actionTypes_default as __DO_NOT_USE__ActionTypes,
  applyMiddleware,
  bindActionCreators,
  combineReducers,
  compose,
  createStore,
  isAction,
  isPlainObject
};
