/**
 * Syntax names shared by the compiler and Node analyzer.
 *
 * These are recognition inputs, not support claims. An adapter still has to prove
 * the imported package/symbol before it can attribute a request.
 */
export const DATA_FLOW_QUERY_ADAPTER_MODULES = Object.freeze([
  "@tanstack/react-query",
  "react-query",
] as const);

export const DATA_FLOW_QUERY_HOOK_NAMES = Object.freeze([
  "useInfiniteQuery",
  "useMutation",
  "useQuery",
] as const);

export const DATA_FLOW_TRPC_CLIENT_FACTORY_NAMES = Object.freeze([
  "createTRPCClient",
  "createTRPCProxyClient",
] as const);

export const DATA_FLOW_TRPC_PROXY_FACTORY_NAMES = Object.freeze([
  "createTRPCNext",
  "createTRPCReact",
] as const);

export const DATA_FLOW_TRPC_ROOT_FACTORY_NAMES = Object.freeze([
  ...DATA_FLOW_TRPC_CLIENT_FACTORY_NAMES,
  ...DATA_FLOW_TRPC_PROXY_FACTORY_NAMES,
  "createTRPCContext",
  "createTRPCOptionsProxy",
] as const);

export const DATA_FLOW_TRPC_REQUEST_METHODS = Object.freeze([
  "infiniteQueryOptions",
  "mutate",
  "mutateAsync",
  "mutationOptions",
  "query",
  "queryOptions",
  "refetch",
  "subscribe",
  "subscriptionOptions",
  "useInfiniteQuery",
  "useMutation",
  "useQuery",
  "useSubscription",
  "useSuspenseInfiniteQuery",
  "useSuspenseQuery",
] as const);
