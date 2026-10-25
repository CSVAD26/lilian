import { CanvasView } from "./components/CanvasView.tsx";
import { Controls } from "./components/Controls.tsx";

function App() {
  return (
    <>
      <div className="flex flex-col sm:flex-row h-full">
        <Controls />
        <main className="stage">
          <CanvasView />
        </main>
      </div>
    </>
  );
}

export default App;
