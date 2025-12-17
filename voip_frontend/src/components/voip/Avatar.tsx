export default function Avatar ({ color }: { color: string }) {
    return (
        <div
            style={{
                width: "50px",
                height: "50px",
                backgroundColor: color,
                borderRadius: "50%",
            }}
        />
    );
};