// Loose React typings: the build server has no @types/react, so React APIs are typed loosely here.
// esbuild does the real build; tsc (npm run typecheck) still catches non-React mistakes.
declare module 'react' {
  const React: any;
  export default React;
  export type ReactNode = any;
  export type ComponentType<P = any> = (props: P) => any;
  export type FormEvent<T = any> = any;
  export type ChangeEvent<T = any> = any;
  export type KeyboardEvent<T = any> = any;
  export type MouseEvent<T = any> = any;
  export type CSSProperties = Record<string, any>;
  export type RefObject<T> = { current: T | null };
  export type Dispatch<A> = (a: A) => void;
  export type SetStateAction<S> = S | ((p: S) => S);
  export function useState<S>(init: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(fn: () => any, deps?: any[]): void;
  export function useLayoutEffect(fn: () => any, deps?: any[]): void;
  export function useMemo<T>(fn: () => T, deps: any[]): T;
  export function useCallback<T extends (...a: any[]) => any>(fn: T, deps: any[]): T;
  export function useRef<T>(init: T): { current: T };
  export function useRef<T>(init: T | null): { current: T | null };
  export function useRef<T = undefined>(): { current: T | undefined };
  export interface Context<T> { Provider: any; Consumer: any; _t?: T }
  export function useContext<T>(c: Context<T>): T;
  export function createContext<T>(v: T): Context<T>;
  export function useReducer(...a: any[]): any;
  export function useId(): string;
  export function useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, getSnapshot: () => T, getServerSnapshot?: () => T): T;
  export function useTransition(): [boolean, (cb: () => void) => void];
  export function useDeferredValue<T>(v: T): T;
  export const Fragment: any;
  export const StrictMode: any;
  export const Suspense: any;
  export function lazy(f: any): any;
  export function memo<T>(c: T): T;
  export function forwardRef(f: any): any;
}
declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}
declare module 'react-dom/client' {
  export function createRoot(el: Element): { render(n: any): void; unmount(): void };
}
declare module 'react-dom' {
  export function createPortal(n: any, el: Element): any;
}
declare namespace React {
  type ReactNode = any;
  type ComponentType<P = any> = (props: P) => any;
  type FormEvent<T = any> = any;
  type ChangeEvent<T = any> = any;
  type KeyboardEvent<T = any> = any;
  type MouseEvent<T = any> = any;
  type CSSProperties = Record<string, any>;
}
declare namespace JSX {
  interface IntrinsicAttributes { key?: any }
  type Element = any;
  interface IntrinsicElements { [name: string]: any }
  interface ElementChildrenAttribute { children: {} }
}
