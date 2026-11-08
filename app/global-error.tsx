import { Component, type ErrorInfo, type ReactNode } from "react";
import { useI18n } from "./lang-provider";
import { useLocation, AppLink } from "./router";
import { LiquidButton } from "./liquid-controls";

function Failure({
  retry,
  reloadRequired,
}: {
  retry: () => void;
  reloadRequired: boolean;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  return (
    <section className="card" role="alert">
      <h1>
        {ar ? "تعذّر عرض هذه الصفحة" : "This page could not be displayed"}
      </h1>
      <p>
        {ar
          ? "تحقق من الاتصال. يمكنك العودة إلى الإرسال دون إعادة تحميل التطبيق."
          : "Check your connection. You can return to Send without reloading the app."}
      </p>
      {!reloadRequired && (
        <LiquidButton onClick={retry}>
          {ar ? "إعادة المحاولة" : "Try again"}
        </LiquidButton>
      )}
      <AppLink href="/">{ar ? "العودة إلى الإرسال" : "Back to Send"}</AppLink>
      <p>
        {ar
          ? "إعادة التحميل تُنهي الاتصال الحالي والنقل غير المحفوظ، ولا تمسح البيانات المحفوظة محليًا."
          : "Reloading ends the current connection and unsaved transfer; it does not erase locally saved data."}
      </p>
      <LiquidButton onClick={() => location.reload()}>
        {ar ? "إعادة تحميل التطبيق" : "Reload app"}
      </LiquidButton>
    </section>
  );
}
class Boundary extends Component<
  { children: ReactNode; route: string },
  { failed: boolean; reloadRequired: boolean }
> {
  state = { failed: false, reloadRequired: false };
  static getDerivedStateFromError(error: Error) {
    return {
      failed: true,
      reloadRequired:
        /dynamically imported|importing a module|loading chunk|module script|failed to fetch/i.test(
          error.message,
        ),
    };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("QRFerry route failed", error, info.componentStack);
  }
  componentDidUpdate(previous: { route: string }) {
    if (previous.route !== this.props.route && this.state.failed)
      this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? (
      <Failure
        retry={() => this.setState({ failed: false })}
        reloadRequired={this.state.reloadRequired}
      />
    ) : (
      this.props.children
    );
  }
}
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const route = useLocation();
  return <Boundary route={route}>{children}</Boundary>;
}
