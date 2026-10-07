"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Toaster } from "@content-ventures/design-system/v3";
import { demoProductions, type Production } from "@/data/editorial-demo";

const EditorialContext = createContext<{
  productions: Production[];
  add: (production: Production) => string;
  update: (id: string, patch: Partial<Production>) => void;
} | null>(null);

export function EditorialProvider({ children }: { children: ReactNode }) {
  const [productions, setProductions] = useState(demoProductions);
  function add(production: Production) {
    const id = crypto.randomUUID();
    setProductions((current) => [{ ...production, id }, ...current]);
    return id;
  }
  function update(id: string, patch: Partial<Production>) {
    setProductions((current) => current.map((item) => item.id === id ? { ...item, ...patch, updated: "Agora" } : item));
  }
  return <EditorialContext.Provider value={{ productions, add, update }}>{children}<Toaster /></EditorialContext.Provider>;
}

export function useEditorial() {
  const context = useContext(EditorialContext);
  if (!context) throw new Error("EditorialProvider is required");
  return context;
}
