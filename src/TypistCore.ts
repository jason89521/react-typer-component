import React from 'react';

import type { Splitter, TypedLines, TypistProps } from './types/TypistProps';
import { emptyFunc } from './utils/defaultFuncs';
import getActions from './utils/getActions';

type T = Omit<TypistProps, 'cursor' | 'disabled' | 'restartKey'>;
type CoreProps = Required<T>;
type SetTypedLines = React.Dispatch<React.SetStateAction<TypedLines>>;

export default class TypistCore {
  #children: React.ReactNode;
  #typingDelay!: number;
  #backspaceDelay!: number;
  #loop!: boolean;
  #pause!: boolean;
  #startDelay!: number;
  #finishDelay!: number;
  #onTypingDone!: () => void;
  #splitter!: Splitter;

  #clearTimer: () => void = emptyFunc;
  #typedLines: TypedLines = [];
  #setTypedLines: SetTypedLines;

  constructor(props: CoreProps, setTypedLines: SetTypedLines) {
    this.setUpProps(props);
    this.#setTypedLines = setTypedLines;
  }

  /** Clear the scheduled timer and make updating component's state invalid in this instance. */
  discard = () => {
    this.#clearTimer();
    this.#setTypedLines = () => {
      throw 'The component has been unmounted.';
    };
  };

  setUpProps = ({
    children,
    typingDelay,
    backspaceDelay,
    loop,
    pause,
    startDelay,
    finishDelay,
    onTypingDone,
    splitter,
  }: CoreProps) => {
    this.#children = children;
    this.#typingDelay = typingDelay;
    this.#backspaceDelay = backspaceDelay;
    this.#loop = loop;
    this.#pause = pause;
    this.#startDelay = startDelay;
    this.#finishDelay = finishDelay;
    this.#onTypingDone = onTypingDone;
    this.#splitter = splitter;
  };

  startTyping = async () => {
    this.#clearTimer();
    try {
      do {
        this.#updateTypedLines([]);
        await this.#timeoutPromise(this.#startDelay);
        const actions = getActions(this.#children);
        for (const action of actions) {
          const { type, payload } = action;
          if (type === 'TYPE_STRING') await this.#typeString(payload);
          else if (type === 'TYPE_ELEMENT') await this.#typeElement(payload);
          else if (type === 'BACKSPACE') await this.#backspace(payload);
          else if (type === 'PAUSE') await this.#timeoutPromise(payload);
          else if (type === 'PASTE') this.#updateTypedLines([...this.#typedLines, payload]);
        }
        this.#onTypingDone();
        await this.#timeoutPromise(this.#finishDelay);
        await this.#loopPromise();
      } while (this.#loop);
    } catch (error) {
      // do nothing
    }
  };

  #timeoutPromise = (delay: number) => {
    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(resolve, delay);
      this.#clearTimer = () => {
        clearTimeout(timeoutId);
        reject();
      };
    });
  };

  /** Resolve when `this.#pause` is `false`. */
  #pausePromise = () => {
    return new Promise<void>((resolve, reject) => {
      const intervalId = setInterval(() => {
        if (this.#pause) return;
        clearInterval(intervalId);
        resolve();
      });
      this.#clearTimer = () => {
        clearInterval(intervalId);
        reject();
      };
    });
  };

  /** Resolve when `this.#loop` is `true`. */
  #loopPromise = () => {
    return new Promise<void>((resolve, reject) => {
      const intervalId = setInterval(() => {
        if (!this.#loop) return;
        clearInterval(intervalId);
        resolve();
      });
      this.#clearTimer = () => {
        clearInterval(intervalId);
        reject();
      };
    });
  };

  /**
   * Each async token should be executed after the pause promise resolve.
   * @param callback
   * @param timeoutDelay
   */
  #executeAsyncToken = async (callback: () => void, timeoutDelay: number) => {
    await this.#pausePromise();
    callback();
    await this.#timeoutPromise(timeoutDelay);
  };

  /**
   * Make sure that `this.#typedLines` can only be set here, and `this.#setTypedLines` can only be called here too.
   * @param newTypedLines
   */
  #updateTypedLines = (newTypedLines: TypedLines) => {
    this.#typedLines = newTypedLines;
    this.#setTypedLines(this.#typedLines);
  };

  #typeString = async (line: string) => {
    const splittedLine = this.#splitter(line);
    const lastIdx = this.#typedLines.length;
    for (let charIdx = 1; charIdx <= splittedLine.length; charIdx++) {
      await this.#executeAsyncToken(() => {
        const newLine = splittedLine.slice(0, charIdx).join('');
        const newTypedLines = [...this.#typedLines];
        newTypedLines[lastIdx] = newLine;
        this.#updateTypedLines(newTypedLines);
      }, this.#typingDelay);
    }
  };

  #typeElement = async (el: React.ReactElement) => {
    await this.#executeAsyncToken(() => {
      this.#updateTypedLines([...this.#typedLines, el]);
    }, this.#typingDelay);
  };

  #backspace = async (amount: number) => {
    while (amount > 0) {
      amount -= 1;
      await this.#executeAsyncToken(() => {
        const typedLines = [...this.#typedLines];
        let lineIndex = typedLines.length - 1;
        let line = typedLines[lineIndex];
        while (line === null && lineIndex > 0) {
          lineIndex -= 1;
          line = typedLines[lineIndex];
        }

        if (line === null) amount = 0;
        if (typeof line === 'object') typedLines[lineIndex] = null;
        if (typeof line === 'string') {
          const splittedLine = this.#splitter(line);
          const newLine = splittedLine.slice(0, -1).join('');
          typedLines[lineIndex] = newLine === '' ? null : newLine;
        }

        this.#updateTypedLines(typedLines);
      }, this.#backspaceDelay);
    }
  };
}
