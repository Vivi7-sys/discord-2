import multiprocessing
from d2win.__main__ import main

if __name__ == '__main__':
    multiprocessing.freeze_support()
    main()
