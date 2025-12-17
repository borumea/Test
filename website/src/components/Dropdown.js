import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import "../styles/Dropdown.css";

const Dropdown = ({ label, options = [], value, onChange, placeholder = "Select an option" }) => {
    const [open, setOpen] = useState(false);
    const [menuStyle, setMenuStyle] = useState({});
    const [filterText, setFilterText] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const dropdownRef = useRef(null);
    const menuRef = useRef(null);
    const inputRef = useRef(null);

    // Filter options based on user input
    const filteredOptions = options.filter(option => {
        if (!option) return false;
        if (!filterText) return true;
        return String(option).toLowerCase().includes(filterText.toLowerCase());
    });

    const handleSelect = (option) => {
        // Only accept valid options from the list
        const isValidOption = options.includes(option);
        onChange(isValidOption ? option : "");
        setFilterText("");
        setIsTyping(false);
        setOpen(false);
    };

    const handleInputChange = (e) => {
        setFilterText(e.target.value);
        setIsTyping(true);
        if (!open) setOpen(true);
    };

    const handleInputBlur = () => {
        // Delay to allow click on menu items
        setTimeout(() => {
            // If what's typed doesn't match any option, clear it
            const exactMatch = options.find(opt => String(opt).toLowerCase() === filterText.toLowerCase());
            if (filterText && !exactMatch) {
                // Don't clear the actual value, just stop typing mode
                setFilterText("");
                setIsTyping(false);
            } else if (exactMatch) {
                onChange(exactMatch);
                setFilterText("");
                setIsTyping(false);
            } else {
                // No filter text, just exit typing mode
                setFilterText("");
                setIsTyping(false);
            }
        }, 200);
    };

    const handleInputFocus = () => {
        // Select all text when clicking into the input
        if (inputRef.current) {
            inputRef.current.select();
        }
        setOpen(true);
    };

    const handleInputKeyDown = (e) => {
        if (e.key === "Enter" && filteredOptions.length > 0) {
            handleSelect(filteredOptions[0]);
        } else if (e.key === "Escape") {
            setFilterText("");
            setIsTyping(false);
            setOpen(false);
        }
    };

    // Update menu position
    const updateMenuPosition = () => {
        if (!dropdownRef.current) return;

        const rect = dropdownRef.current.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const spaceBelow = viewportHeight - rect.bottom - 10;
        const menuHeight = Math.min(300, filteredOptions.length * 40); // Estimate menu height
        const shouldOpenUp = spaceBelow < menuHeight && rect.top > menuHeight;

        setMenuStyle({
            position: "fixed", // Use fixed positioning for better portal behavior
            top: shouldOpenUp
                ? `${rect.top - menuHeight - 6}px`
                : `${rect.bottom + 6}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            maxHeight: "300px",
            overflowY: "auto",
            zIndex: 999999,
        });
    };

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(e.target) &&
                menuRef.current &&
                !menuRef.current.contains(e.target)
            ) {
                setOpen(false);
                setFilterText("");
                setIsTyping(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Update position when opening, scrolling, or resizing
    useEffect(() => {
        if (open) {
            updateMenuPosition();
            const handleUpdate = () => {
                requestAnimationFrame(updateMenuPosition);
            };
            window.addEventListener("scroll", handleUpdate, true); // Use capture phase
            window.addEventListener("resize", handleUpdate);
            return () => {
                window.removeEventListener("scroll", handleUpdate, true);
                window.removeEventListener("resize", handleUpdate);
            };
        }
    }, [open, filteredOptions.length]);

    // Focus input when opening
    useEffect(() => {
        if (open && inputRef.current) {
            inputRef.current.focus();
        }
    }, [open]);

    // Render menu in portal
    const dropdownMenu = open && (
        <div className="dropdown-menu" ref={menuRef} style={menuStyle}>
            {filteredOptions.length > 0 ? (
                filteredOptions.map((option) => (
                    <div
                        key={option}
                        className={`dropdown-item ${option === value ? "selected" : ""}`}
                        onMouseDown={(e) => {
                            // Use onMouseDown instead of onClick to fire before onBlur
                            e.preventDefault();
                            e.stopPropagation();
                            handleSelect(option);
                        }}
                    >
                        {option}
                    </div>
                ))
            ) : (
                <div className="dropdown-item disabled">
                    {filterText ? "No matching options" : "No options"}
                </div>
            )}
        </div>
    );

    // Display value: show filterText while typing, otherwise show selected value
    const displayValue = isTyping ? filterText : (value || "");

    return (
        <div className={`dropdown ${open ? "open" : ""}`} ref={dropdownRef}>
            {label && <label className="dropdown-label">{label}</label>}

            <div 
                className="dropdown-select" 
                onClick={() => {
                    if (!open && inputRef.current) {
                        inputRef.current.focus();
                    }
                }}
            >
                <input
                    ref={inputRef}
                    type="text"
                    className="dropdown-input"
                    value={displayValue}
                    onChange={handleInputChange}
                    onBlur={handleInputBlur}
                    onFocus={handleInputFocus}
                    onKeyDown={handleInputKeyDown}
                    placeholder={placeholder}
                    style={{
                        backgroundColor: "transparent",
                        border: "none",
                        outline: "none",
                        boxShadow: "none"
                    }}
                />
            </div>

            {createPortal(dropdownMenu, document.body)}
        </div>
    );
};

export default Dropdown;