import logging
from threading import Event


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    logging.info("Worker scaffold started; task execution is not implemented yet")
    Event().wait()


if __name__ == "__main__":
    main()
