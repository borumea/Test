import React from "react";

const ErrorPopup = ({ message, onClose }) => {
    if (!message) return null;

    return (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
            <div className="bg-white rounded-lg shadow-lg p-6 max-w-sm text-center">
                <p className="text-red-600 font-medium mb-4">{message}</p>
                <button
                    onClick={onClose}
                    className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition"
                >
                    Close
                </button>
            </div>
        </div>
    );
};

export default ErrorPopup;
