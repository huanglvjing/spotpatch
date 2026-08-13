import {
  forwardRef,
  Fragment,
  memo,
  type ComponentPropsWithoutRef,
  type JSX,
  useState,
} from "react";
import { Button } from "antd";

import styles from "./fixture.module.css";

export const MemoPanel = memo(function MemoPanel(): JSX.Element {
  return (
    <article className="fixture-card" data-testid="memo-panel">
      <h3>Memo component fixture</h3>
      <p>Memo keeps its application display name.</p>
    </article>
  );
});

MemoPanel.displayName = "MemoPanel";

export const ForwardField = forwardRef<
  HTMLInputElement,
  ComponentPropsWithoutRef<"input">
>(function ForwardField(properties, reference): JSX.Element {
  return (
    <label className="fixture-card">
      ForwardRef component fixture
      <input
        {...properties}
        ref={reference}
        data-testid="forward-field"
        placeholder="Forwarded input"
      />
    </label>
  );
});

ForwardField.displayName = "ForwardField";

export function FragmentFixture(): JSX.Element {
  return (
    <Fragment>
      <button data-testid="fragment-first" type="button">
        Fragment first root
      </button>
      <button data-testid="fragment-second" type="button">
        Fragment second root
      </button>
    </Fragment>
  );
}

const LIST_ITEMS = Object.freeze([
  { id: "alpha", label: "Mapped item alpha" },
  { id: "beta", label: "Mapped item beta" },
  { id: "gamma", label: "Mapped item gamma" },
]);

export function ListFixture(): JSX.Element {
  return (
    <article className="fixture-card">
      <h3>Mapped list fixture</h3>
      <ul data-testid="mapped-list">
        {LIST_ITEMS.map((item) => (
          <li data-testid={`list-item-${item.id}`} key={item.id}>
            {item.label}
          </li>
        ))}
      </ul>
    </article>
  );
}

export function CssModuleFixture(): JSX.Element {
  return (
    <article className={styles.moduleCard} data-testid="css-module-card">
      <h3>CSS Module fixture</h3>
      <p>The generated class must retain its matching stylesheet rule.</p>
    </article>
  );
}

export function DataFlowFixture(): JSX.Element {
  const [rows, setRows] = useState<readonly { id: number }[]>([]);

  async function loadRows(): Promise<void> {
    const response = await fetch("/api/e2e/users?token=never-display-token&page=1");
    const result = (await response.json()) as {
      data: { list: readonly { id: number }[] };
    };
    setRows(result.data.list);
  }

  return (
    <article className="fixture-card">
      <h3>Component data flow</h3>
      <Button
        data-testid="data-flow-button"
        type="primary"
        onClick={() => {
          void loadRows();
        }}
      >
        Load component rows
      </Button>
      <span data-testid="data-flow-count">{rows.length}</span>
    </article>
  );
}

export function SecurityFixture(): JSX.Element {
  return (
    <form className="security-form" data-testid="security-form">
      <label>
        Password
        <input
          autoComplete="current-password"
          defaultValue="never-leak-password"
          name="password"
          type="password"
        />
      </label>
      <label>
        Access token
        <input defaultValue="never-leak-token" name="access_token" type="text" />
      </label>
      <a href="https://demo:credential@example.test/callback?token=never-leak-url-token&next=%2Fdashboard">
        Sanitized callback
      </a>
      <button data-testid="security-submit" type="submit">
        Sign in fixture
      </button>
    </form>
  );
}
