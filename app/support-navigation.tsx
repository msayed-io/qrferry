"use client";

import { createContext, useContext } from "react";

/** Ephemeral UI return path only. No persistent data or transport state. */
export const SupportReturnContext = createContext("/");
export const useSupportReturn = () => useContext(SupportReturnContext);
export const SUPPORT_ROUTES = ["/history", "/privacy", "/offline"];
