import { Component, ElementRef, forwardRef, Input, OnInit, ViewChild } from '@angular/core';
import { NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';

import { Node as MarkdownNode, Parser } from 'commonmark';
import { DomPath, DomPoint, DomSelection, formatTextContent, moveCursor, removeChildren } from '../../utils/dom';
import { insertBefore, nextOf, nextOfMapped, previousOf, previousOfMapped, remove, first } from '../../utils/array';
import { children } from '../../utils/markdown';
import { wordAtOffset } from '../../utils/string';
import { isDefined, requireDefined } from '../../utils/object';
import { ConceptNode } from '../../entities/node';
import { isModalClose } from '../../utils/modal';

class Model {

  public content: Paragraph[] = [];

  linkableSelection: LinkableSelection|null = null;
  linkedSelection: LinkedSelection|null = null;

  constructor(public node: Element) {
    removeChildren(node);
  }

  static ofMarkdown(container: HTMLElement, documentNode: MarkdownNode): Model {

    if (documentNode.type !== 'document') {
      throw new Error('Not an document, was: ' + documentNode.type);
    }

    const result = new Model(container);

    for (const paragraphNode of children(documentNode)) {
      result.addParagraph(Paragraph.ofMarkdown(result, paragraphNode));
    }

    return result;
  }

  private addParagraph(paragraph: Paragraph) {
    this.content.push(paragraph);
    this.node.appendChild(paragraph.node);
  }

  private insertParagraphBefore(newParagraph: Paragraph, ref: Paragraph) {
    insertBefore(this.content, newParagraph, ref);
    this.node.insertBefore(newParagraph.node, ref.node);
  }

  has(paragraph: Paragraph) {
    return this.content.indexOf(paragraph) !== -1;
  }

  insertNewParagraph() {

    const selection = requireDefined(this.getSelection());

    const {text, offset} = selection.remove()!;
    const newParagraph = new Paragraph(this);
    this.insertParagraphBefore(newParagraph, text.containingParagraph);
    Model.moveCursor(text.containingParagraph.splitTo(newParagraph, text, offset));
  }

  insertChar(char: string) {

    const selection = requireDefined(this.getSelection());

    const {text, offset} = selection.remove()!;
    Model.moveCursor(text.insertText(char, offset));
  }

  removeNextChar() {

    const selection = requireDefined(this.getSelection());

    if (selection.isRange()) {
      Model.moveCursor(selection.remove());
    } else {
      const {text, offset} = selection.start;
      Model.moveCursor(text.removeNextChar(offset));
    }
  }

  removePreviousChar() {

    const selection = requireDefined(this.getSelection());

    if (selection.isRange()) {
      Model.moveCursor(selection.remove());
    } else {
      const {text, offset} = selection.start;
      Model.moveCursor(text.removePreviousChar(offset));
    }
  }

  findTextForPath(indicesFromRoot: number[]): Text {
    const index = indicesFromRoot.shift()!;
    return this.content[index].findTextForPath(indicesFromRoot);
  }

  getPrecedingText(paragraph: Paragraph): Text|null {

    const previous = previousOf(this.content, paragraph);

    if (previous) {
      return previous.lastText;
    } else {
      return null;
    }
  }

  getFollowingText(paragraph: Paragraph): Text|null {

    const next = nextOf(this.content, paragraph);

    if (next) {
      return next.firstText;
    } else {
      return null;
    }
  }

  removeContent(paragraph: Paragraph) {
    this.node.removeChild(paragraph.node);
    remove(this.content, paragraph);
  }

  getSelection(): Selection|null {

    if (this.content.length === 0) {

      const newParagraph = new Paragraph(this);
      const newText = new Text(newParagraph);
      newParagraph.addContent(newText);
      this.addParagraph(newParagraph);
      Model.moveCursor(new Point(newText, 0));
    }

    return Selection.ofDomSelection(this, new DomSelection(this.node));
  }

  private static moveCursor(point: Point|null) {
    if (point) {
      moveCursor(point.text.node, point.offset);
    }
  }

  link(target: string) {

    if (this.linkableSelection === null) {
      throw new Error('Illegal state');
    }

    const { start, end, cursor } = this.linkableSelection;
    const paragraph = this.linkableSelection.paragraph;
    const text = this.linkableSelection.text;
    const selectionAsLink = new Link(paragraph, this.linkableSelection.content, target);

    if (start > 0) {
      paragraph.addContentBefore(new Text(paragraph, text.content.substring(0, start)), text);
    }

    paragraph.addContentBefore(selectionAsLink, text);

    if (end < text.length) {
      paragraph.addContentBefore(new Text(paragraph, text.content.substring(end, text.length)), text);
    }

    text.remove();

    Model.moveCursor(new Point(selectionAsLink.text, cursor - start));
    this.updateSelection();
  }

  unlink() {

    if (this.linkedSelection === null) {
      throw new Error('Illegal state');
    }

    const paragraph = this.linkedSelection.paragraph;
    const link = this.linkedSelection.link;
    const linkAsText = new Text(paragraph, link.content);

    paragraph.addContentBefore(linkAsText, link);
    link.remove();
    paragraph.mergeConsecutiveTexts(new Point(linkAsText, this.linkedSelection.cursor));
    this.updateSelection();
  }

  updateSelection() {

    const selection = this.getSelection();

    if (selection) {
      this.linkableSelection = selection.linkable;
      this.linkedSelection = selection.link;
    }
  }

  removeLinkSelections() {
    this.linkableSelection = null;
    this.linkedSelection = null;
  }

  toMarkdown(): string {
    return this.content.map(c => c.toMarkdown()).join('').trim();
  }

  get cursorOffset(): number {

    try {
      const selection = this.getSelection();

      if (selection) {

        let offset = selection.start.offset;

        for (let text = selection.start.text.getPrecedingText(); text !== null; text = text.getPrecedingText()) {
          offset += text.length;
        }

        return offset;
      } else {
        return 0;
      }

    } catch (e) {
      return 0;
    }
  }

  private cursorOffsetToPoint(offset: number): Point|null {

    if (this.content.length === 0) {
      return null;
    } else {

      let offsetWalked = 0;

      for (let text: Text|null = this.content[0].firstText; text !== null; text = text.getFollowingText()) {

        offsetWalked += text.length;

        if (offset <= offsetWalked) {
          return new Point(text, text.length - (offsetWalked - offset));
        }
      }

      const lastParagraph = this.content[this.content.length - 1];
      const lastText = lastParagraph.lastText;

      return new Point(lastText, lastText.length);
    }
  }

  moveCursorToOffset(offset: number) {
    Model.moveCursor(this.cursorOffsetToPoint(offset));
  }

  removeStartOfLine() {
    console.log('remove start of line, not implemented yet'); // TODO
  }

  removeEndOfLine() {
    console.log('remove rest of line, not implemented yet'); // TODO
  }

  removeNextWord() {
    console.log('remove next word, not implemented yet'); // TODO
  }

  removePreviousWord() {
    console.log('remove previous word, not implemented yet'); // TODO
  }

  copy(): string {

    const selection = this.getSelection();

    if (selection) {
      return selection.toPlainString();
    } else {
      return '';
    }
  }

  paste(text: string) {

    const selection = this.getSelection();

    if (selection) {
      const pointAfterRemoval = requireDefined(selection.remove());
      Model.moveCursor(pointAfterRemoval.text.append(text));
    }
  }

  cut(): string {

    const text = this.copy();
    const selection = this.getSelection();

    if (selection) {
      Model.moveCursor(selection.remove());
    }

    return text;
  }
}

class Paragraph {

  node: HTMLElement;

  constructor(private parent: Model, private content: (Link|Text)[] = []) {
    this.node = document.createElement('p');
  }

  static ofMarkdown(parent: Model, paragraphNode: MarkdownNode): Paragraph {

    if (paragraphNode.type !== 'paragraph') {
      throw new Error('Not a paragraph, was: ' + paragraphNode.type);
    }

    const result = new Paragraph(parent);

    for (const child of children(paragraphNode)) {
      result.addContent(child.type === 'link' ? Link.ofMarkdown(result, child) : Text.ofMarkdown(result, child));
    }

    return result;
  }

  combineWith(paragraph: Paragraph): Point|null {

    if (paragraph === this) {
      // nothing to do
      return null;
    }

    const lastOfThis = this.content[this.content.length - 1];
    const lastContentBeforeChanges = lastOfThis.text.content;

    let firstChild = true;

    for (const content of paragraph.content) {

      if (firstChild && lastOfThis instanceof Text && content instanceof Text) {

        if (lastOfThis.content.trim() !== '') {
          lastOfThis.append(content.content);
        } else {
          lastOfThis.content = content.content;
        }
      } else {
        this.addContent(content.copyToParent(this));
      }

      firstChild = false;
    }

    paragraph.remove();
    return new Point(lastOfThis.text, lastContentBeforeChanges.trim() === '' ? 0 : lastContentBeforeChanges.length);
  }

  splitTo(prependingParagraph: Paragraph, fromText: Text, fromOffset: number): Point {

    const contentToRemove: (Link|Text)[] = [];

    for (const content of this.content) {

      const isSplittingText = content.text === fromText;

      if (isSplittingText) {
        const contentText = content.content;
        prependingParagraph.appendText(contentText.substring(0, fromOffset));
        content.content = contentText.substring(fromOffset, fromText.length);
        break; // nothing to do after split point is handled
      }

      prependingParagraph.addContent(content.copyToParent(prependingParagraph));
      contentToRemove.push(content);
    }

    for (const content of contentToRemove) {
      content.remove();
    }

    if (prependingParagraph.empty) {
      prependingParagraph.addContent(new Text(prependingParagraph));
    }

    return new Point(this.firstText, 0);
  }

  appendText(text: string) {
    if (this.content.length > 0 && this.lastContent instanceof Text) {
      this.lastContent.append(text);
    } else {
      this.addContent(new Text(this, text));
    }
  }

  mergeConsecutiveTexts(cursor: Point) {

    let cursorAfterMerging = cursor;

    if (this.content.length < 2) {
      // nothing to do
    } else {

      let i = 1;

      while (i < this.content.length) {

        const previous = this.content[i-1];
        const current = this.content[i];

        if (previous instanceof Text && current instanceof Text) {

          const previousLengthBeforeAppending = previous.length;
          previous.append(current.content);

          if (cursor.text === current) {
            cursorAfterMerging = new Point(previous, previousLengthBeforeAppending + cursorAfterMerging.offset);
          }

          current.remove();
        } else {
          i++;
        }
      }
    }

    moveCursor(cursorAfterMerging.text.node, cursorAfterMerging.offset);
  }

  addContent(content: Link|Text) {
    this.content.push(content);
    this.node.appendChild(content.node);
  }

  addContentBefore(content: Link|Text, ref: Link|Text) {
    insertBefore(this.content, content, ref);
    this.node.insertBefore(content.node, ref.node);
  }

  get paragraph(): Paragraph {
    return this;
  }

  get empty() {
    return this.content.length === 0;
  }

  remove() {
    this.parent.removeContent(this);
  }

  removeContent(content: Text|Link): void {
    if (this.content.length === 1) {
      this.parent.removeContent(this);
    } else {
      this.node.removeChild(content.node);
      remove(this.content, content);
    }
  }

  findTextForPath(indicesFromRoot: number[]): Text {

    if (indicesFromRoot.length === 0) {
      // at least chrome seems to return paragraph in selection
      return this.firstText;
    }

    const index = indicesFromRoot.shift()!;
    return this.content[index].findTextForPath(indicesFromRoot);
  }

  getPrecedingText(text: Text): Text|null {

    const previous = previousOfMapped(this.content, c => c.text, text);

    if (previous) {
      return previous.text;
    } else {
      return this.parent.getPrecedingText(this);
    }
  }

  getFollowingText(text: Text): Text|null {

    const next = nextOfMapped(this.content, c => c.text, text);

    if (next) {
      return next.text;
    } else {
      return this.parent.getFollowingText(this);
    }
  }

  get lastContent(): Text|Link {
    if (this.content.length === 0) {
      throw new Error('No content in paragraph');
    }

    return this.content[this.content.length - 1];
  }

  get lastText(): Text {
    return this.lastContent.text;
  }

  get firstContent(): Text|Link {
    if (this.content.length === 0) {
      throw new Error('No content in paragraph');
    }

    return this.content[0];
  }

  get firstText(): Text {
    return this.firstContent.text;
  }

  toMarkdown(): string {
    return '\n\n' + this.content.map(c => c.toMarkdown()).join('');
  }
}

class Link {

  private _text: Text;
  private _target: string;
  node: HTMLElement;

  constructor(private parent: Paragraph, text: string, target: string) {
    this.node = document.createElement('span');
    this.node.classList.add('link');
    this.text = new Text(this, text);
    this.target = target;
  }

  static ofMarkdown(parent: Paragraph, link: MarkdownNode): Link {

    if (link.type !== 'link') {
      throw new Error('Not a paragraph, was: ' + link.type);
    }

    const text = children(link);

    if (text.length !== 1) {
      throw new Error('Not a single child, was: ' + text.length);
    }

    return new Link(parent, text[0].literal, link.destination);
  }

  copyToParent(parent: Paragraph): Link {
    return new Link(parent, this.content, this.target);
  }

  get content() {
    return this.text.content;
  }

  set content(value: string) {
    this.text.content = value;
  }

  get text() {
    return this._text;
  }

  set text(value: Text) {

    this._text = value;

    for (const child of Array.from(this.node.childNodes.values())) {
      this.node.removeChild(child);
    }

    this.node.appendChild(value.node);
  }

  get target() {
    return this._target;
  }

  set target(value: string) {
    this._target = value;
    this.node.dataset['target'] = value;
  }

  remove(): void {
    this.parent.removeContent(this);
  }

  removeContent(text: Text): void {

    if (text !== this.text) {
      throw new Error('Illegal argument');
    }

    this.remove();
  }

  findTextForPath(indicesFromRoot: number[]): Text {
    const index = indicesFromRoot.shift()!;

    if (index !== 0 || indicesFromRoot.length !== 0) {
      throw new Error('Illegal state');
    }

    return this.text;
  }

  getPrecedingText(): Text|null {
    return this.parent.getPrecedingText(this.text);
  }

  getFollowingText(): Text|null {
    return this.parent.getFollowingText(this.text);
  }

  get paragraph(): Paragraph {
    return this.parent;
  }

  toMarkdown(): string {
    return `[${this.content}](${this.target})`;
  }
}

class Text {

  private _content: string;
  node: Node;

  constructor(public parent: Paragraph|Link, content = '') {
    this.node = document.createTextNode('');
    this.content = content;
  }

  static ofMarkdown(parent: Paragraph|Link, text: MarkdownNode): Text {

    if (text.type !== 'text') {
      throw new Error('Not a text, was: ' + text.type);
    }

    return new Text(parent, text.literal);
  }

  copyToParent(parent: Paragraph): Text {
    return new Text(parent, this.content);
  }

  get content(): string {
    return this._content;
  }

  set content(value: string) {
    this._content = value || ' ';
    this.node.textContent = formatTextContent(this.content);
  }

  get text() {
    return this;
  }

  get containingParagraph(): Paragraph {
    return this.parent.paragraph;
  }

  get length() {
    return this.content.length;
  }

  isInLink() {
    return this.parent instanceof Link;
  }

  remove(): Point|null {

    const previous = this.getPrecedingText();

    // FIXME: typescript won't type check without this no-op type guard
    if (this.parent instanceof Paragraph ) {
      this.parent.removeContent(this);
    } else {
      this.parent.removeContent(this);
    }

    if (previous) {
      return new Point(previous.text, previous.text.length);
    } else {
      return null;
    }
  }

  removeNextChar(offset: number): Point|null {

    if (offset >= this.content.length) {
      const next = this.getFollowingText();

      if (next) {
        if (next.containingParagraph !== this.containingParagraph) {
          return this.containingParagraph.combineWith(next.containingParagraph);
        } else {
          return next.removeFirstCharacter();
        }
      } else {
        return null;
      }
    } else {
      return this.removeRange(offset, offset + 1);
    }
  }

  removePreviousChar(offset: number): Point|null {

    if (offset <= 0) {
      const previous = this.getPrecedingText();

      if (previous) {
        if (previous.containingParagraph !== this.containingParagraph) {
          return previous.containingParagraph.combineWith(this.containingParagraph);
        } else {
          return previous.removeLastCharacter();
        }
      } else {
        return null;
      }
    } else {
      return this.removeRange(offset - 1, offset);
    }
  }

  removeAfter(offset: number): Point|null {
    return this.removeRange(offset, this.content.length);
  }

  removeBefore(offset: number): Point|null {
    return this.removeRange(0, offset);
  }

  removeLastCharacter(): Point|null {

    if (this.content.length <= 1) {
      return this.remove();
    } else {
      return this.removeRange(this.content.length - 1, this.content.length);
    }
  }

  removeFirstCharacter(): Point|null {
    if (this.content.length <= 1) {
      return this.remove();
    } else {
      return this.removeRange(0, 1);
    }
  }

  removeRange(start: number, end: number): Point|null {

    if (start < 0 || end > this.content.length) {
      throw new Error('remove range not in bounds, ' + start + ' .. ' + end + ' of [' + this.content + '] (' + this.content.length + ')');
    }

    if (start === 0 && end === this.content.length) {
      return this.remove();
    } else {
      const beforeStart = this.content.substring(0, start);
      const afterEnd = this.content.substring(end);
      this.content = beforeStart + afterEnd;

      return new Point(this, start);
    }
  }

  insertText(text: string, offset: number): Point {

    const start = this.content.substring(0, offset);
    const end = this.content.substring(offset, this.content.length);
    this.content = start + text + end;
    return new Point(this, offset + text.length)
  }

  append(text: string): Point {

    this.content = this.content + text;
    return new Point(this, this.content.length);
  }

  findTextForPath(indicesFromRoot: number[]): Text {

    if (indicesFromRoot.length !== 0) {
      throw new Error('Illegal state');
    }

    return this;
  }

  getPrecedingText(): Text|null {
    if (this.parent instanceof Paragraph) {
      return this.parent.getPrecedingText(this);
    } else {
      return this.parent.getPrecedingText();
    }
  }

  getFollowingText(): Text|null {
    if (this.parent instanceof Paragraph) {
      return this.parent.getFollowingText(this);
    } else {
      return this.parent.getFollowingText();
    }
  }

  toMarkdown(): string {
    return this.content;
  }
}


class Point {
  constructor(public text: Text, public offset: number) {
  }
}

class Selection {

  textBetween: Text[] = [];

  constructor(private model: Model, public start: Point, public end: Point) {

    if (this.start.text !== this.end.text) {
      for (let t = this.start.text.getFollowingText()!; t !== this.end.text; t = t.getFollowingText()!) {
        this.textBetween.push(t);
      }
    }
  }

  static ofDomSelection(model: Model, domSelection: DomSelection): Selection|null {

    function createPoint(domPoint: DomPoint) {

      if (domPoint.node === model.node) {
        return null;
      }

      const indicesFromRoot = domPoint.path.indicesFromRoot;
      const text = model.findTextForPath(indicesFromRoot);

      return text ? new Point(text, domPoint.offset) : null;
    }

    const startPoint = createPoint(domSelection.start);
    const endPoint = createPoint(domSelection.end);

    if (startPoint && endPoint) {
      return new Selection(model, startPoint, endPoint);
    } else {
      return null;
    }
  }

  private isLinkable() {
    return this.start.text === this.end.text && !this.start.text.isInLink();
  }

  private isLink() {
    return this.start.text === this.end.text && this.start.text.isInLink();
  }

  get link(): LinkedSelection|null {
    if (this.isLink()) {
      return new LinkedSelection(this.end.text.parent as Link, this.end.offset);
    } else {
      return null;
    }
  }

  get linkable(): LinkableSelection|null {
    if (this.isLinkable()) {
      if (this.isRange()) {
        return new LinkableSelection(this.start.text, this.start.offset, this.end.offset, this.end.offset);
      } else {

        const wordRange = wordAtOffset(this.start.text.content, this.start.offset);

        if (wordRange) {
          return new LinkableSelection(this.start.text, wordRange.start, wordRange.end, this.end.offset);
        } else {
          return null;
        }
      }
    } else {
      return null;
    }
  }

  isRange() {
    return this.start.text !== this.end.text || this.start.offset !== this.end.offset;
  }

  remove(): Point|null {

    if (!this.isRange()) {
      return this.start;
    }

    if (this.start.text !== this.end.text) {

      for (const text of this.textBetween) {
        text.remove();
      }

      const startParagraph = this.start.text.containingParagraph;
      const endParagraph = this.end.text.containingParagraph;
      const pointAfterRemoval = this.start.text.removeAfter(this.start.offset);
      this.end.text.removeBefore(this.end.offset);

      if (this.model.has(startParagraph) && this.model.has(endParagraph)) {
        startParagraph.combineWith(endParagraph);
      }

      return pointAfterRemoval;
    } else {
      return this.start.text.removeRange(this.start.offset, this.end.offset);
    }
  }

  toPlainString() {

    const start = this.start.text.content;
    const end = this.end.text.content;

    if (this.start.text === this.end.text) {
      return start.substring(this.start.offset, this.end.offset);
    } else {

      let result = start.substring(this.start.offset, start.length);

      for (const text of this.textBetween) {
        result += text.content;
      }

      result += end.substring(0, this.end.offset);

      return result;
    }
  }

  toString() {
    const createDomPath = (point: Point) => new DomPath(this.model.node, point.text.node);
    return `From ${createDomPath(this.start).toString()}(${this.start.offset}) to ${createDomPath(this.end).toString()}(${this.end.offset})`;
  }
}

class LinkableSelection {

  constructor(public text: Text, public start: number, public end: number, public cursor: number) {
  }

  get content() {
    return this.text.content.substring(this.start, this.end);
  }

  get paragraph() {
    return this.text.containingParagraph;
  }
}

class LinkedSelection {

  constructor(public link: Link, public cursor: number) {
  }

  get content() {
    return this.link.content;
  }

  get paragraph() {
    return this.link.paragraph;
  }

  get target() {
    return this.link.target;
  }
}

const keyCodes = {
  backspace: 8,
  enter: 13,
  esc: 27,
  space: 32,
  del: 46,
  a: 65,
  b: 66,
  c: 67,
  d: 68,
  h: 72,
  i: 73,
  k: 75,
  u: 85,
  v: 86,
  x: 88,
  y: 89,
  z: 90
};

function isAlt(event: KeyboardEvent, keyCode?: number) {
  return !event.metaKey && !event.ctrlKey && event.altKey && (isDefined(keyCode) ? event.keyCode === keyCode : true);
}

function isCtrl(event: KeyboardEvent, keyCode?: number) {
  return !event.metaKey && event.ctrlKey && !event.altKey && (isDefined(keyCode) ? event.keyCode === keyCode : true);
}

function isMeta(event: KeyboardEvent, keyCode?: number) {
  return event.metaKey && !event.ctrlKey && !event.altKey && (isDefined(keyCode) ? event.keyCode === keyCode : true);
}

function isPlain(event: KeyboardEvent, keyCode?: number) {
  return !event.metaKey && !event.ctrlKey && !event.altKey && (isDefined(keyCode) ? event.keyCode === keyCode : true);
}

function isUndo(event: KeyboardEvent) {
  return isCtrl(event, keyCodes.z) || isMeta(event, keyCodes.z);
}

function isRedo(event: KeyboardEvent) {
  return (isMeta(event, keyCodes.z) && event.shiftKey) || isCtrl(event, keyCodes.y);
}

function isBoldCommand(event: KeyboardEvent) {
  return isCtrl(event, keyCodes.b) || isMeta(event, keyCodes.b);
}

function isItalicCommand(event: KeyboardEvent) {
  return isCtrl(event, keyCodes.i) || isMeta(event, keyCodes.i);
}

function isUnderlineCommand(event: KeyboardEvent) {
  return isCtrl(event, keyCodes.u) || isMeta(event, keyCodes.u);
}

function isRemovePreviousChar(event: KeyboardEvent) {
  return isPlain(event, keyCodes.backspace) || isCtrl(event, keyCodes.h);
}

function isRemoveNextChar(event: KeyboardEvent) {
  return isPlain(event, keyCodes.del) || isCtrl(event, keyCodes.d);
}

function isRemovePreviousWord(event: KeyboardEvent) {
  return isCtrl(event, keyCodes.backspace) || isAlt(event, keyCodes.backspace);
}

function isRemoveNextWord(event: KeyboardEvent) {
  return isAlt(event, keyCodes.del);
}

function isRemoveStartOfLine(event: KeyboardEvent) {
  return isMeta(event, keyCodes.backspace);
}

function isRemoveRestOfLine(event: KeyboardEvent) {
  return isCtrl(event, keyCodes.k);
}

@Component({
  selector: 'markdown-input',
  styleUrls: ['./markdown-input.component.scss'],
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => MarkdownInputComponent),
    multi: true
  }],
  template: `    
    <markdown-input-link-popover *ngIf="hasLinkableSelection()"
                            [selectedText]="linkableSelection.content"
                            (link)="link()">
    </markdown-input-link-popover>
    
    <markdown-input-unlink-popover *ngIf="hasLinkedSelection()"
                            [concept]="linkedConcept"
                            (unlink)="unlink()">
    </markdown-input-unlink-popover>
    
    <div #editable contenteditable="true" [class.form-control]="formControl"></div>
  `
})
export class MarkdownInputComponent implements OnInit, ControlValueAccessor {

  @Input() conceptSelector: (name: string) => Promise<ConceptNode>;
  @Input() relatedConcepts: ConceptNode[];

  @Input('formControlClass') formControl = true;
  @ViewChild('editable') editableElement: ElementRef;

  private model: Model;
  private undoStack: { markdown: string, cursorOffset: number }[] = [];
  private redoStack: { markdown: string, cursorOffset: number }[] = [];

  linkingInProgress = false;
  private propagateChange: (fn: any) => void = () => {};
  private propagateTouched: (fn: any) => void = () => {};

  private undoDebounceTimeoutHandle: any = null;

  ngOnInit(): void {

    const element = this.editableElement.nativeElement as HTMLElement;
    this.model = new Model(element);

    element.addEventListener('keydown', (event: KeyboardEvent) => {

      if (isUnderlineCommand(event)) {
        console.log('underline command prevented');
        event.preventDefault();
      } else if (isItalicCommand(event)) {
        console.log('italic command prevented');
        event.preventDefault();
      } else if (isBoldCommand(event)) {
        console.log('bold command prevented');
        event.preventDefault();
      } else if (isRemoveStartOfLine(event)) {
        this.reportChange(() => this.model.removeStartOfLine());
        event.preventDefault();
      } else if (isRemoveRestOfLine(event)) {
        this.reportChange(() => this.model.removeEndOfLine());
        event.preventDefault();
      } else if (isRemovePreviousWord(event)) {
        this.reportChange(() => this.model.removePreviousWord());
        event.preventDefault();
      } else if (isRemoveNextWord(event)) {
        this.reportChange(() => this.model.removeNextWord());
        event.preventDefault();
      } else if (isRemoveNextChar(event)) {
        this.reportChange(() => this.model.removeNextChar());
        event.preventDefault();
      } else if (isRemovePreviousChar(event)) {
        this.reportChange(() => this.model.removePreviousChar());
        event.preventDefault();
      } else if (isRedo(event)) {
        this.redo();
        event.preventDefault();
      } else if (isUndo(event)) {
        this.undo();
        event.preventDefault();
      } else {
        // catch rest in key press handler which handles all text appending
      }
    });

    element.addEventListener('keypress', (event: KeyboardEvent) => {

      if (event.keyCode === keyCodes.enter) {
        this.reportChange(() => this.model.insertNewParagraph());
        event.preventDefault();
      } else if(event.keyCode === keyCodes.space) {
        this.reportChange(() => this.model.insertChar(' '));
        event.preventDefault();
      } else if (event.charCode === keyCodes.esc) {
        // nothing to do
      } else if (event.charCode) {
        this.reportChange(() => this.model.insertChar(event.key));
        event.preventDefault();
      }
    });

    element.addEventListener('keyup', () => {
      this.model.updateSelection();
    });

    element.addEventListener('mouseup', (event: Event) => {
      this.model.updateSelection();
      event.preventDefault();
    });

    element.addEventListener('blur', () => {

      setTimeout(() => {
        if (!this.linkingInProgress) {
          this.model.removeLinkSelections();
        }
      }, 200);
    });

    element.addEventListener('copy', (event: ClipboardEvent) => {
      event.clipboardData.setData('text/plain', this.model.copy());
      event.preventDefault();
    });

    element.addEventListener('paste', (event: ClipboardEvent) => {
      this.reportChange(() => this.model.paste(event.clipboardData.getData('Text')));
      event.preventDefault();
    });

    element.addEventListener('cut', (event: ClipboardEvent) => {
      this.reportChange(() => event.clipboardData.setData('text/plain', this.model.cut()));
      event.preventDefault();
    });
  }

  hasLinkableSelection() {

    if (!this.conceptSelector) {
      return false;
    }

    return this.model.linkableSelection !== null;
  }

  get linkableSelection() {
    return requireDefined(this.model.linkableSelection);
  }

  hasLinkedSelection() {
    return this.model.linkedSelection !== null;
  }

  get linkedSelection() {
    return requireDefined(this.model.linkedSelection);
  }

  get linkedConcept(): ConceptNode|null {
    // FIXME: proper mapping
    const target = this.linkedSelection.target;
    return first(this.relatedConcepts, concept => (isDefined(concept.code) &&
      (target.indexOf(concept.code) !== -1)) || target.indexOf(concept.id) !== -1);
  }

  link() {
    this.linkingInProgress = true;

    this.conceptSelector(this.linkableSelection.content)
      .then(concept => {
        this.reportChange(() => {
          this.model.link(concept.id);
          this.linkingInProgress = false;
        });
      }, err => {
        this.linkingInProgress = false;

        if (!isModalClose(err)) {
          throw err;
        }
      });
  }

  unlink() {
    this.reportChange(() => this.model.unlink());
  }

  undo() {
    if (this.undoStack.length > 1) {
      this.pushUndoIfChanged(false);
      // current state is at the top the stack
      this.redoStack.push(this.undoStack.pop()!);
      const {markdown, cursorOffset} = this.undoStack[this.undoStack.length - 1];
      this.resetModel(markdown, cursorOffset);
      this.propagateChange(markdown);
    }
  }

  redo() {

    if (this.undoDebounceTimeoutHandle) {
      this.pushUndoIfChanged(true);
    }

    if (this.redoStack.length > 0) {
      const historyItem = this.redoStack.pop()!;
      this.undoStack.push(historyItem);
      this.resetModel(historyItem.markdown, historyItem.cursorOffset);
      this.propagateChange(historyItem.markdown);
    }
  }

  private pushUndoIfChanged(resetRedo: boolean) {

    if (this.undoDebounceTimeoutHandle) {
      clearTimeout(this.undoDebounceTimeoutHandle);
      this.undoDebounceTimeoutHandle = null;
    }

    const historyItem = { markdown: this.model.toMarkdown(), cursorOffset: this.model.cursorOffset };
    const topOfStack = this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1] : null;

    if (!topOfStack || topOfStack.markdown !== historyItem.markdown) {

      this.undoStack.push(historyItem);

      if (resetRedo) {
        this.redoStack = [];
      }
    }
  }

  private undoDebounce() {

    const debounceTime = 500;

    if (this.undoDebounceTimeoutHandle) {
      clearTimeout(this.undoDebounceTimeoutHandle);
    }

    this.undoDebounceTimeoutHandle = setTimeout(() => this.pushUndoIfChanged(true), debounceTime);
  }

  private reportChange(modifyingAction: () => void) {

    if (!this.undoDebounceTimeoutHandle) {
      // do an initial push
      this.pushUndoIfChanged(true);
    }

    this.undoDebounce();
    modifyingAction();
    this.propagateChange(this.model.toMarkdown());
  }

  private resetModel(markdown: string, cursorOffset?: number) {

    const element = this.editableElement.nativeElement as HTMLElement;
    this.model = Model.ofMarkdown(element, new Parser().parse(markdown));

    if (cursorOffset) {
      this.model.moveCursorToOffset(cursorOffset);
    }
  }

  writeValue(obj: any): void {

    const value = obj || '';

    if (typeof value !== 'string') {
      throw new Error('Value must be a string');
    }

    this.undoStack = [];
    this.redoStack = [];

    this.resetModel(value);
  }

  registerOnChange(fn: any): void {
    this.propagateChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.propagateTouched = fn;
  }
}