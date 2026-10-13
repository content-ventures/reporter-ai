'use client';
import { ButtonLink, PageHeader, PageStack, Panel, Section } from '@content-ventures/design-system/v3';
import { LibraryBrowser } from './library-browser';
export function ImagesScreen() {
  return <PageStack><PageHeader title="Imagens" actions={<ButtonLink href="/banners">Criar banner</ButtonLink>} />
    <Panel><Section title="Biblioteca editorial"><LibraryBrowser /></Section></Panel></PageStack>;
}
